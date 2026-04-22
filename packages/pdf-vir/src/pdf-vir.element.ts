import {assert} from '@augment-vir/assert';
import {
    createArray,
    Debounce,
    DebounceStyle,
    DeferredPromise,
    ensureError,
    extractErrorMessage,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {
    asyncProp,
    attributes,
    type AttributeValues,
    css,
    type CSSResult,
    defineElement,
    defineElementEvent,
    html,
    ifDefined,
    onDomCreated,
    repeat,
} from 'element-vir';
import * as pdfjs from 'pdfjs-dist';
import {GlobalWorkerOptions, type PDFDocumentProxy} from 'pdfjs-dist';
import {type DocumentInitParameters} from 'pdfjs-dist/types/src/display/api.js';
import {LoaderAnimated24Icon, ViraIcon} from 'vira';
import {type PdfSource, toPdfSourceKey} from './pdf-source.js';

export {type DocumentInitParameters} from 'pdfjs-dist/types/src/display/api.js';
export {arePdfSourcesEqual, toPdfSourceKey, type PdfSource} from './pdf-source.js';

/**
 * All inputs for {@link PdfVir}.
 *
 * @category Internal
 */
export type PdfVirInputs = {
    /**
     * This is the main entry point for loading a PDF.
     *
     * If a URL is used to fetch the PDF data a standard Fetch API call (or XHR as fallback) is
     * used, which means it must follow same origin rules, e.g. no cross-domain requests without
     * CORS.
     *
     * @see `getDocument` at https://mozilla.github.io/pdf.js/api/
     */
    pdfSource: PdfSource;
    /**
     * Used to set `GlobalWorkerOptions.workerSrc` on the PDFJs library. This is required or the
     * library simply crashes. This should be a string containing the path and filename of the
     * worker file. (Copy `node_modules/pdfjs-dist/build/pdf.worker.mjs` to your public directory.)
     */
    pdfJsWorkerPath: string;
} & PartialWithUndefined<{
    /**
     * Caps the pixel count of each rendered page. Pages whose natural size exceeds this cap are
     * rendered at a lower `scale` so the canvas pixel buffer (width × height × 4 bytes) stays
     * bounded, which prevents out-of-memory crashes on weak devices.
     *
     * @default 500_000 // ~2MB of canvas memory per page
     */
    maxPixelsPerPage: number;
    stylePassthrough: PartialWithUndefined<Record<PdfVirElements, CSSResult>>;
    attributePassthrough: PartialWithUndefined<Record<PdfVirElements, AttributeValues>>;
}>;

const defaultMaxPixelsPerPage = 500_000;

/** Defaults applied to {@link pdfjs.getDocument} to keep memory bounded on weak devices: */
const defaultLoadOptions = {
    /**
     * `disableAutoFetch`: pdfjs otherwise prefetches the entire file after the first byte range,
     * which spikes memory. With this off, pdfjs fetches only the byte ranges it actually needs.
     */
    disableAutoFetch: true,
} as const satisfies DocumentInitParameters;

function toDocumentInitParameters(source: PdfSource): DocumentInitParameters {
    if (typeof source === 'string' || source instanceof URL) {
        return {
            ...defaultLoadOptions,
            url: source,
        };
    } else if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
        return {
            ...defaultLoadOptions,
            data: source,
        };
    }
    return {
        ...defaultLoadOptions,
        ...source,
    };
}

/**
 * All internal elements of {@link PdfVir} that you can pass styles or attributes to.
 *
 * @category Internal
 */
export type PdfVirElements = 'canvas' | 'canvas-wrapper' | 'loader' | 'error';

/**
 * Event detail for the `pdfLoad` event, and also the shared base shape for `canvasCreate` and
 * `canvasLoad` event details.
 *
 * @category Internal
 */
export type PdfLoadEventDetail = {
    /** The total pages in the document. */
    pageCount: number;
    pdfDocument: PDFDocumentProxy;
    pdfSource: PdfSource;
};

/**
 * Destroys a settled pdf document (if it is one — skips `undefined` and `Error` settled values),
 * freeing pdfjs's parsed pages, fonts, and worker-side buffers. Runs in the background; surfaces
 * any failure through `onError` so callers can dispatch a `pdfError` event.
 */
async function destroyPdfDocument(settled: undefined | Error | PDFDocumentProxy) {
    if (settled && !(settled instanceof Error)) {
        await settled.destroy();
    }
}

/**
 * An element-vir custom-web-element for rendering PDFs inline with HTML.
 *
 * @category Main
 */
export const PdfVir = defineElement<PdfVirInputs>()({
    tagName: 'pdf-vir',
    styles: css`
        :host {
            background-color: #999;
            display: flex;
            flex-direction: column;
            gap: 32px;
            width: 600px;
            height: 800px;
            max-width: 100%;
            overflow-y: scroll;
            padding: 32px;
        }

        .canvas-wrapper {
            position: relative;
            box-sizing: border-box;
            width: 100%;
            /*
             * Reserves scroll space for pages whose canvases haven't rendered yet, scaled to the
             * host's current width (so narrow windows don't leave huge gaps). Uses the US
             * letter aspect (8.5:11) as a stand-in; actual rendered canvases have their own
             * intrinsic height and override this ratio once they've drawn.
             */
            aspect-ratio: 8.5 / 11;
        }

        .canvas-wrapper:has(canvas[width]) {
            /* Stop constraining the aspect once the canvas has real dimensions. */
            aspect-ratio: auto;
        }

        canvas {
            max-width: 100%;
            height: auto;
            box-sizing: border-box;
        }

        .error {
            width: 100%;
            max-height: 100%;
            box-sizing: border-box;
            font-weight: bold;
            color: red;
        }

        .loader {
            background-color: white;
            box-sizing: border-box;
            width: 100%;
            height: 200px;
            max-height: 100%;
            padding: 8px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
    `,
    events: {
        canvasLoad: defineElementEvent<
            {
                canvas: HTMLCanvasElement;
                context: CanvasRenderingContext2D;
                pageNumber: number;
            } & PdfLoadEventDetail
        >(),
        /**
         * Fires once per page as soon as its `<canvas>` is attached to the DOM — before any PDF
         * rendering happens. Lets consumers grab the canvas reference (for example to scroll to a
         * specific page) without having to wait for the page to enter the viewport and render.
         */
        canvasCreate: defineElementEvent<
            {
                canvas: HTMLCanvasElement;
                /** The current page that this canvas corresponds to. */
                pageNumber: number;
            } & PdfLoadEventDetail
        >(),
        pdfLoad: defineElementEvent<PdfLoadEventDetail>(),
        pdfError: defineElementEvent<Error>(),
    },
    state({events, dispatch}) {
        return {
            pagePromises: [] as DeferredPromise[],
            lastSourceKey: undefined as undefined | string,
            /** Page indices whose render has been kicked off (or completed). */
            renderedPages: new Set<number>(),
            /** Observers that must be disconnected on source change or element removal. */
            pageObservers: [] as IntersectionObserver[],
            /**
             * Per-page debounce whose callbacks we null out on source change / element removal so a
             * scroll-through-fast timer doesn't fire a render against a stale pdf document.
             */
            pageDebounce: [] as Debounce[],
            pdfDocument: asyncProp({
                async updateCallback({pdfSource}: {pdfSource: PdfSource}) {
                    try {
                        const pdfDocument = await pdfjs.getDocument(
                            toDocumentInitParameters(pdfSource),
                        ).promise;
                        dispatch(
                            new events.pdfLoad({
                                pageCount: pdfDocument.numPages,
                                pdfDocument,
                                pdfSource,
                            }),
                        );
                        return pdfDocument;
                    } catch (caught) {
                        const error = ensureError(caught);
                        dispatch(new events.pdfError(error));
                        throw error;
                    }
                },
            }),
        };
    },
    cleanup({state}) {
        state.pageObservers.forEach((observer) => observer.disconnect());
        state.pageDebounce.forEach((debounce) => {
            debounce.callback = undefined;
        });
        void destroyPdfDocument(state.pdfDocument.settledValue);
    },
    render({state, updateState, inputs, dispatch, events}) {
        GlobalWorkerOptions.workerSrc = inputs.pdfJsWorkerPath;
        const pdfSource = inputs.pdfSource;
        const sourceKey = toPdfSourceKey(pdfSource);
        state.pdfDocument.update({
            pdfSource,
        });
        if (sourceKey !== state.lastSourceKey) {
            void destroyPdfDocument(state.pdfDocument.settledValue);
            state.pageObservers.forEach((observer) => observer.disconnect());
            state.pageDebounce.forEach((debounce) => {
                debounce.callback = undefined;
            });
            updateState({
                pagePromises: [],
                renderedPages: new Set<number>(),
                pageObservers: [],
                pageDebounce: [],
                lastSourceKey: sourceKey,
            });
        }

        if (!state.pdfDocument.settledValue) {
            return html`
                <div
                    class="loader"
                    ${attributes(inputs.attributePassthrough?.loader)}
                    style=${ifDefined(inputs.stylePassthrough?.loader)}
                >
                    <${ViraIcon.assign({
                        icon: LoaderAnimated24Icon,
                    })}></${ViraIcon}>
                </div>
            `;
        } else if (state.pdfDocument.settledValue instanceof Error) {
            return html`
                <div
                    class="error"
                    ${attributes(inputs.attributePassthrough?.error)}
                    style=${ifDefined(inputs.stylePassthrough?.error)}
                >
                    PDF load failed:
                    ${extractErrorMessage(state.pdfDocument.settledValue) || 'Unknown Error'}
                </div>
            `;
        }

        const pdfDocument: PDFDocumentProxy = state.pdfDocument.settledValue;

        return repeat(
            createArray(pdfDocument.numPages, (index) => index),
            (index) =>
                [
                    sourceKey,
                    index,
                ].join(':'),
            (index) => html`
                <div
                    class="canvas-wrapper"
                    ${attributes(inputs.attributePassthrough?.['canvas-wrapper'])}
                    style=${ifDefined(inputs.stylePassthrough?.['canvas-wrapper'])}
                >
                    <canvas
                        ${attributes(inputs.attributePassthrough?.canvas)}
                        style=${ifDefined(inputs.stylePassthrough?.canvas)}
                        ${onDomCreated((canvas) => {
                            assert.instanceOf(canvas, HTMLCanvasElement);

                            const pageNumber = index + 1;

                            /*
                             * Let consumers grab the canvas reference as soon as it's in the DOM,
                             * before any PDF rendering has triggered. This allows consumers to scroll to specific pages.
                             */
                            dispatch(
                                new events.canvasCreate({
                                    canvas,
                                    pageNumber,
                                    pageCount: pdfDocument.numPages,
                                    pdfSource,
                                    pdfDocument,
                                }),
                            );

                            const startRender = async () => {
                                if (state.renderedPages.has(index)) {
                                    return;
                                }
                                /*
                                 * Mark + disconnect synchronously so a fast re-fire before the
                                 * async render body runs can't double-schedule this page.
                                 */
                                state.renderedPages.add(index);
                                observer.disconnect();

                                /*
                                 * Serialize renders across all pages (regardless of page
                                 * order) so simultaneous scroll-ins don't spike memory by
                                 * rendering multiple pdfjs pages in parallel. Each render
                                 * awaits whatever render was last queued.
                                 */
                                const pagePromise = new DeferredPromise();
                                const previousPage = state.pagePromises.at(-1);
                                state.pagePromises.push(pagePromise);

                                try {
                                    await previousPage?.promise;

                                    const pdfPage = await pdfDocument.getPage(pageNumber);
                                    const maxPixels =
                                        inputs.maxPixelsPerPage ?? defaultMaxPixelsPerPage;
                                    const baseViewport = pdfPage.getViewport({
                                        scale: 1,
                                    });
                                    const basePixels = baseViewport.width * baseViewport.height;
                                    const scale =
                                        basePixels > maxPixels
                                            ? Math.sqrt(maxPixels / basePixels)
                                            : 1;
                                    const viewport = pdfPage.getViewport({
                                        scale,
                                    });

                                    canvas.width = viewport.width;
                                    canvas.height = viewport.height;
                                    const context = canvas.getContext('2d');

                                    assert.isDefined(context);

                                    const renderTask = pdfPage.render({
                                        canvasContext: context,
                                        viewport,
                                        canvas,
                                    });
                                    await renderTask.promise;
                                    dispatch(
                                        new events.canvasLoad({
                                            canvas,
                                            context,
                                            pageNumber,
                                            pageCount: pdfDocument.numPages,
                                            pdfSource,
                                            pdfDocument,
                                        }),
                                    );
                                    /*
                                     * Free pdfjs's parsed operator list and cached resources
                                     * for this page now that the canvas pixels (and any
                                     * overlay drawing done by `canvasLoad` listeners) are
                                     * baked in. Rendered pixels on the canvas are unaffected.
                                     */
                                    pdfPage.cleanup();
                                } catch (error) {
                                    dispatch(new events.pdfError(ensureError(error)));
                                } finally {
                                    pagePromise.resolve();
                                }
                            };

                            /*
                             * Debounce scroll-through: the first time the page enters the
                             * prefetch window, schedule a fire 150ms later. When that fire
                             * lands, render only if the page is still visible — fast scrolls
                             * leave `isVisible` false at fire time, so those pages are skipped.
                             */
                            let isVisible = false;
                            const renderDebounce = new Debounce(
                                DebounceStyle.AfterWait,
                                {
                                    milliseconds: 150,
                                },
                                () => {
                                    if (isVisible) {
                                        void startRender();
                                    }
                                },
                            );
                            state.pageDebounce.push(renderDebounce);

                            const observer = new IntersectionObserver(
                                (entries) => {
                                    isVisible = entries.some((entry) => entry.isIntersecting);
                                    if (isVisible) {
                                        renderDebounce.execute();
                                    }
                                },
                                {
                                    /*
                                     * Start considering the page 500px before it enters the
                                     * viewport so that, combined with the dwell debounce, a
                                     * page the user slows near gets a head start.
                                     */
                                    rootMargin: '500px',
                                },
                            );
                            state.pageObservers.push(observer);
                            observer.observe(canvas);
                        })}
                    ></canvas>
                </div>
            `,
        );
    },
});
