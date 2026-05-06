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
import {LoaderAnimated24Icon, ViraIcon} from 'vira';
import {loadPdfDocument, type PdfDocument} from './pdf-document.js';
import {type PdfSource, toPdfSourceKey} from './pdf-source.js';

export {loadPdfDocument, PdfDocument} from './pdf-document.js';
export {
    arePdfSourcesEqual,
    toPdfSourceKey,
    type PdfData,
    type PdfSource,
    type PdfSourceOptions,
} from './pdf-source.js';

/**
 * All inputs for {@link PdfVir}.
 *
 * @category Internal
 */
export type PdfVirInputs = {
    /**
     * This is the main entry point for loading a PDF. May be a URL string, a `URL`, raw PDF bytes
     * (`ArrayBuffer` / typed array), or a `PdfSourceOptions` object that includes a password or
     * fetch options. URL fetches use the standard Fetch API, so cross-origin requests must follow
     * the usual same-origin / CORS rules.
     */
    pdfSource: PdfSource;
    /**
     * URL of the PDFium WebAssembly binary. Required: PDFium cannot run without it. Copy
     * `node_modules/@embedpdf/pdfium/dist/pdfium.wasm` into your public assets and pass the URL it
     * is served from here.
     */
    pdfiumWasmUrl: string | URL;
} & PartialWithUndefined<{
    /**
     * Caps the pixel count of each rendered page. Pages whose natural size exceeds this cap are
     * rendered at a lower `scale` so the canvas pixel buffer (width × height × 4 bytes) stays
     * bounded, which prevents out-of-memory crashes on weak devices.
     *
     * @default 2_000_000 // ~8MB of canvas memory per page; ~2x scale on a US letter page
     */
    maxPixelsPerPage: number;
    stylePassthrough: PartialWithUndefined<Record<PdfVirElements, CSSResult>>;
    attributePassthrough: PartialWithUndefined<Record<PdfVirElements, AttributeValues>>;
}>;

const defaultMaxPixelsPerPage = 2_000_000;

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
    pdfDocument: PdfDocument;
    pdfSource: PdfSource;
};

/**
 * Destroys a settled pdf document (if it is one — skips `undefined` and `Error` settled values),
 * freeing the PDFium native handles and the underlying data buffer.
 */
function destroyPdfDocument(settled: undefined | Error | PdfDocument) {
    if (settled && !(settled instanceof Error)) {
        settled.destroy();
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
                async updateCallback({
                    pdfSource,
                    pdfiumWasmUrl,
                }: {
                    pdfSource: PdfSource;
                    pdfiumWasmUrl: string | URL;
                }) {
                    try {
                        const pdfDocument = await loadPdfDocument({
                            source: pdfSource,
                            pdfiumWasmUrl,
                        });
                        dispatch(
                            new events.pdfLoad({
                                pageCount: pdfDocument.pageCount,
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
        destroyPdfDocument(state.pdfDocument.settledValue);
    },
    render({state, updateState, inputs, dispatch, events}) {
        const pdfSource = inputs.pdfSource;
        const sourceKey = toPdfSourceKey(pdfSource);
        state.pdfDocument.update({
            pdfSource,
            pdfiumWasmUrl: inputs.pdfiumWasmUrl,
        });
        if (sourceKey !== state.lastSourceKey) {
            destroyPdfDocument(state.pdfDocument.settledValue);
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

        const pdfDocument: PdfDocument = state.pdfDocument.settledValue;

        return repeat(
            createArray(pdfDocument.pageCount, (index) => index),
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
                             * before any PDF rendering has triggered. This allows consumers to
                             * scroll to specific pages.
                             */
                            dispatch(
                                new events.canvasCreate({
                                    canvas,
                                    pageNumber,
                                    pageCount: pdfDocument.pageCount,
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
                                 * rendering multiple pages in parallel — and so the shared
                                 * PDFium WASM heap is only touched by one render at a time.
                                 * Each render awaits whatever render was last queued.
                                 */
                                const pagePromise = new DeferredPromise();
                                const previousPage = state.pagePromises.at(-1);
                                state.pagePromises.push(pagePromise);

                                try {
                                    await previousPage?.promise;

                                    const maxPixels =
                                        inputs.maxPixelsPerPage ?? defaultMaxPixelsPerPage;
                                    const result = pdfDocument.renderPage({
                                        pageNumber,
                                        canvas,
                                        computeScale({widthPoints, heightPoints}) {
                                            const basePixels = widthPoints * heightPoints;
                                            return basePixels > maxPixels
                                                ? Math.sqrt(maxPixels / basePixels)
                                                : 1;
                                        },
                                    });
                                    dispatch(
                                        new events.canvasLoad({
                                            canvas,
                                            context: result.context,
                                            pageNumber,
                                            pageCount: pdfDocument.pageCount,
                                            pdfSource,
                                            pdfDocument,
                                        }),
                                    );
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
