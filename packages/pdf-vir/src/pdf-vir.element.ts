import {assert, check} from '@augment-vir/assert';
import {
    createArray,
    Debounce,
    DebounceStyle,
    DeferredPromise,
    ensureError,
    extractErrorMessage,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {type AnyDuration} from 'date-vir';
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
    unsafeCSS,
} from 'element-vir';
import {LoaderAnimated24Icon, lucideIcons, ViraIcon, viraTheme} from 'vira';
import {loadPdfDocument, type PdfDocument} from './pdf-document.js';
import {type PdfSource, toPdfSourceKey} from './pdf-source.js';
import {
    computeDeviceMaxPixelsPerPage,
    computeMaxRenderScale,
    computeRenderScale,
} from './render-scale.js';
import {clampZoomScale, computeAnchoredScrollPosition, isPointInPaddedRect} from './zoom-util.js';

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
     * Caps the pixel count of each rendered page. Pages whose target size exceeds this cap are
     * rendered at a lower `scale` so the canvas pixel buffer (width × height × 4 bytes) stays
     * bounded, which prevents out-of-memory crashes on weak devices.
     *
     * Defaults to a budget derived from what the browser reports about the device: between
     * 2_000_000 pixels (~8MB per page) and 8_000_000 (~32MB per page).
     */
    maxPixelsPerPage: number;
    /**
     * Multiplies the render resolution beyond what each page's on-screen size requires. Values
     * above 1 keep pages sharp in the window between a zoom and its re-render, at the cost of that
     * multiplier squared in canvas memory.
     *
     * @default 1
     */
    renderScaleMultiplier: number;
    /**
     * When `true`, renders a floating zoom toolbar (zoom out, zoom in, reset) at the top of the
     * scrollable viewer. Zooming scales already-rendered canvases via CSS and then re-renders the
     * pages on screen at the new zoom level, up to the resolution `maxPixelsPerPage` allows.
     *
     * @default false
     */
    enableZoomControls: boolean;
    stylePassthrough: PartialWithUndefined<Record<PdfVirElements, CSSResult>>;
    attributePassthrough: PartialWithUndefined<Record<PdfVirElements, AttributeValues>>;
}>;

/**
 * Read once at module load: neither value changes for the life of the page, and both are missing on
 * some browsers.
 */
const defaultMaxPixelsPerPage = computeDeviceMaxPixelsPerPage({
    deviceMemoryGb: readNavigatorNumber('deviceMemory'),
    cpuCoreCount: readNavigatorNumber('hardwareConcurrency'),
});
const defaultRenderScaleMultiplier = 1;
/**
 * How far outside the viewport a page keeps its rendered pixels. Beyond this, the canvas buffer is
 * released and the page re-renders if the user scrolls back. Must stay comfortably wider than
 * {@link pageRenderMargin} so a page isn't freed and re-rendered repeatedly by small scrolls.
 */
const pageEvictionMargin = '2000px';
/**
 * How far ahead of the viewport a page starts rendering, giving it a head start before the user
 * reaches it.
 */
const pageRenderMargin = '500px';
/**
 * How long zooming must settle before visible pages re-render. Long enough that clicking zoom in
 * several times in a row only triggers one round of renders.
 */
const zoomRerenderDelay: AnyDuration = {
    milliseconds: 300,
};
const zoomMin = 0.5;
const zoomMax = 4;
const zoomStepFactor = 1.25;
const defaultZoomScale = 1;
const epsilon = 0.001;
const zoomToolbarHideDelay: AnyDuration = {
    seconds: 2,
};
const zoomToolbarHoverPaddingPx = 32;

/**
 * All internal elements of {@link PdfVir} that you can pass styles or attributes to.
 *
 * @category Internal
 */
export type PdfVirElements =
    | 'canvas'
    | 'canvas-wrapper'
    | 'error'
    | 'loader'
    | 'zoom-button'
    | 'zoom-toolbar';

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
 * Reads a numeric `navigator` property that not every browser implements, such as the Chromium-only
 * `deviceMemory`.
 */
function readNavigatorNumber(key: string): number | undefined {
    const value = check.hasKey(globalThis.navigator, key) ? globalThis.navigator[key] : undefined;

    return check.isNumber(value) ? value : undefined;
}

/**
 * Handle onto a single page canvas, kept so the element can re-render the pages currently on screen
 * when the zoom level changes.
 *
 * @category Internal
 */
export type PageRenderer = {
    /** Renders the page, unless it already rendered at the current zoom level or higher. */
    render: () => Promise<void>;
    /** Whether the page is currently within the viewport's prefetch window. */
    isVisible: () => boolean;
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
    cssVars: {
        /**
         * Multiplier applied to canvas-wrapper widths to drive zoom. Defaults to 1; the element
         * sets it to {@link defaultZoomScale} → {@link zoomMin}..{@link zoomMax} when the user clicks
         * the zoom toolbar buttons.
         */
        'pdf-vir-zoom-scale': '1',
    },
    styles: ({cssVars}) => css`
        :host {
            background-color: ${
                /**
                 * Use the default value because we don't want the background changing in dark mode:
                 * the PDF white background won't change when switching to dark mode.
                 */
                unsafeCSS(viraTheme.colors['vira-grey-behind-bg-header'].background.default)
            };
            width: 600px;
            height: 800px;
            max-width: 100%;
            /*
             * Host is the positioning context for the absolutely-placed zoom toolbar but does
             * not scroll itself — that role belongs to the inner .scroll-container. This keeps
             * the toolbar pinned over the host while pages scroll or zoom underneath.
             */
            position: relative;
            overflow: hidden;
        }

        .scroll-container {
            box-sizing: border-box;
            width: 100%;
            height: 100%;
            padding: 32px;
            display: flex;
            flex-direction: column;
            /*
             * Center children on the cross (horizontal) axis so zoomed canvas-wrappers grow
             * equally in both directions instead of extending only to the right. The 'safe'
             * keyword is critical: with plain 'center', a child wider than this container can't
             * be scrolled past its centered flex position (the left portion becomes
             * unreachable). 'safe center' falls back to 'flex-start' when overflow would
             * otherwise hide content, keeping both edges scrollable while still centering
             * content that fits.
             */
            align-items: safe center;
            gap: 32px;
            overflow-y: scroll;
            overflow-x: auto;
        }

        .canvas-wrapper {
            position: relative;
            box-sizing: border-box;
            /*
             * Multiplies the wrapper width by the current zoom factor (defaults to 1 when zoom
             * controls are disabled). Zoom > 1 makes the wrapper exceed the host's content width
             * and triggers horizontal scrolling.
             */
            width: calc(100% * ${cssVars['pdf-vir-zoom-scale'].value});
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
            width: 100%;
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

        .zoom-toolbar {
            /*
             * Absolutely positioned over the host so it doesn't move when the inner scroll
             * container scrolls (vertically or horizontally) or when the user zooms.
             * translateX(-50%) keeps the pill centered against left:50% regardless of its
             * own width.
             */
            position: absolute;
            top: 8px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 1;
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 4px;
            background-color: rgba(40, 40, 40, 0.85);
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            border-radius: 999px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            opacity: 0;
            pointer-events: none;
            transition: opacity 200ms ease;
        }

        .zoom-toolbar.visible {
            opacity: 1;
            pointer-events: auto;
        }

        .zoom-button {
            width: 36px;
            height: 36px;
            padding: 0;
            background: transparent;
            border: none;
            border-radius: 50%;
            color: white;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .zoom-button:hover:not(:disabled) {
            background-color: rgba(255, 255, 255, 0.15);
        }

        .zoom-button:disabled {
            opacity: 0.4;
            cursor: default;
        }

        .zoom-button ${ViraIcon} {
            width: 20px;
            height: 20px;
        }

        .zoom-divider {
            width: 1px;
            height: 22px;
            background-color: rgba(255, 255, 255, 0.3);
        }
    `,
    events: {
        canvasLoad: defineElementEvent<
            {
                canvas: HTMLCanvasElement;
                /**
                 * Already scaled to PDF points (1/72 inch per unit), so overlays drawn on it line
                 * up with the page without needing to account for zoom scale.
                 */
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
            zoomScale: defaultZoomScale,
            isToolbarVisible: false,
            /**
             * Mirror of `inputs.enableZoomControls && pdfReady`, synced from `render`. The
             * mousemove/mouseleave handlers attached in `init` read this to bail out of state churn
             * while the toolbar is disabled or the PDF isn't ready, without having to re-query
             * inputs.
             */
            isToolbarActive: false,
            toolbarHideDebounce: new Debounce(DebounceStyle.AfterWait, zoomToolbarHideDelay),
            /**
             * Holder for the AbortController that's `abort()`ed in `cleanup` to remove the host
             * mouse listeners. Wrapped in an object so the `current` field can be mutated without
             * going through `updateState` (this is non-reactive lifecycle state).
             */
            toolbarListeners: {
                current: undefined as undefined | AbortController,
            },
            /**
             * Holder for the tail of the per-page render serialization chain. Each page's render
             * awaits this before starting and replaces it with its own promise, so renders never
             * run in parallel against the shared pdfium WASM heap. A single ref instead of an array
             * keeps memory bounded across long sessions on large documents.
             */
            lastPagePromise: {
                current: undefined as undefined | DeferredPromise,
            },
            lastSourceKey: undefined as undefined | string,
            /**
             * One entry per page canvas currently in the DOM, used to re-render the pages the user
             * is looking at after a zoom change.
             */
            pageRenderers: [] as PageRenderer[],
            zoomRerenderDebounce: new Debounce(DebounceStyle.AfterWait, zoomRerenderDelay),
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
    init({host, state, updateState}) {
        /**
         * Mutable ref tracked in `init`'s closure so updates on every mousemove don't trigger a
         * re-render. The debounce callback reads `pointerNearRef.value` to decide whether to skip
         * the auto-hide.
         */
        const pointerNearRef = {
            value: false,
        };

        const isPointerInToolbarZone = (event: MouseEvent): boolean => {
            const toolbar = host.shadowRoot.querySelector('.zoom-toolbar');
            if (!(toolbar instanceof HTMLElement)) {
                return false;
            }
            return isPointInPaddedRect({
                point: {
                    x: event.clientX,
                    y: event.clientY,
                },
                rect: toolbar.getBoundingClientRect(),
                padding: zoomToolbarHoverPaddingPx,
            });
        };

        state.toolbarHideDebounce.callback = () => {
            /*
             * Skip the auto-hide while the pointer is hovering the toolbar's expanded zone so a
             * user lining up to click a button doesn't watch it disappear out from under them.
             * The debounce keeps re-arming via mousemove; once the pointer leaves the zone, the
             * normal countdown (zoomToolbarHideDelay) resumes.
             */
            if (pointerNearRef.value) {
                return;
            }
            if (state.isToolbarVisible) {
                updateState({
                    isToolbarVisible: false,
                });
            }
        };

        state.zoomRerenderDebounce.callback = () => {
            /*
             * Re-render only what the user is looking at. Off-screen pages pick up the new zoom
             * from their intersection observer when they scroll back in.
             */
            state.pageRenderers.forEach((renderer) => {
                if (renderer.isVisible()) {
                    void renderer.render();
                }
            });
        };

        const abortController = new AbortController();
        state.toolbarListeners.current = abortController;
        const listenerOptions = {
            signal: abortController.signal,
        };

        host.addEventListener(
            'mousemove',
            (event) => {
                /*
                 * Bail when zoom controls are disabled or the PDF isn't ready: avoids state
                 * churn and re-renders driven by mouse movement when no toolbar is shown.
                 */
                if (!state.isToolbarActive) {
                    return;
                }
                pointerNearRef.value = isPointerInToolbarZone(event);
                if (!state.isToolbarVisible) {
                    updateState({
                        isToolbarVisible: true,
                    });
                }
                state.toolbarHideDebounce.execute();
            },
            listenerOptions,
        );
        host.addEventListener(
            'mouseleave',
            () => {
                /*
                 * Hide immediately when the cursor leaves the host bounds entirely. Mouse moves
                 * inside the shadow DOM (including over the toolbar itself) bubble as
                 * `mousemove` on the host, so the timer keeps resetting while the user is
                 * interacting; `mouseleave` only fires when the cursor exits the host bounds.
                 */
                pointerNearRef.value = false;
                if (state.isToolbarVisible) {
                    updateState({
                        isToolbarVisible: false,
                    });
                }
            },
            listenerOptions,
        );
    },
    cleanup({state}) {
        state.pageObservers.forEach((observer) => observer.disconnect());
        state.pageDebounce.forEach((debounce) => {
            debounce.callback = undefined;
        });
        state.toolbarHideDebounce.callback = undefined;
        state.zoomRerenderDebounce.callback = undefined;
        state.toolbarListeners.current?.abort();
        destroyPdfDocument(state.pdfDocument.settledValue);
    },
    render({state, updateState, inputs, dispatch, events, host, cssVars}) {
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
            state.lastPagePromise.current = undefined;
            updateState({
                pageRenderers: [],
                pageObservers: [],
                pageDebounce: [],
                lastSourceKey: sourceKey,
                /*
                 * Reset zoom + toolbar visibility so a fresh PDF doesn't inherit prior viewing
                 * state — switching documents at 4x and seeing the new one already zoomed-in is
                 * surprising.
                 */
                zoomScale: defaultZoomScale,
                isToolbarVisible: false,
            });
        }

        const settled = state.pdfDocument.settledValue;
        const pdfReady = !!settled && !(settled instanceof Error);
        const isToolbarActive = !!inputs.enableZoomControls && pdfReady;
        if (state.isToolbarActive !== isToolbarActive) {
            updateState({
                isToolbarActive,
                /*
                 * Force-hide when the toolbar deactivates (e.g. PDF errored, or controls
                 * disabled at runtime) so a stale `visible` class doesn't linger if it
                 * reactivates later.
                 */
                isToolbarVisible: isToolbarActive ? state.isToolbarVisible : false,
            });
        }

        const canZoomIn = state.zoomScale < zoomMax - epsilon;
        const canZoomOut = state.zoomScale > zoomMin + epsilon;
        const canResetZoom = Math.abs(state.zoomScale - defaultZoomScale) > epsilon;

        const updateZoom = (next: number) => {
            const previousScale = state.zoomScale;
            const newScale = clampZoomScale(next, {
                min: zoomMin,
                max: zoomMax,
            });
            if (Math.abs(newScale - previousScale) < epsilon) {
                return;
            }
            const scrollContainer = host.shadowRoot.querySelector('.scroll-container');
            assert.instanceOf(scrollContainer, HTMLElement);
            /*
             * Capture the viewport's center in scroll-content coordinates *before* the zoom is
             * applied, then re-anchor it to the same content point after the new layout settles.
             * Without this, zooming visually shifts the part of the page the user was looking at
             * — they'd zoom in expecting the center to stay put, but the layout grows from a
             * different anchor instead.
             */
            const oldScrollLeft = scrollContainer.scrollLeft;
            const oldScrollTop = scrollContainer.scrollTop;
            const viewWidth = scrollContainer.clientWidth;
            const viewHeight = scrollContainer.clientHeight;
            const oldScrollWidth = scrollContainer.scrollWidth;
            const oldScrollHeight = scrollContainer.scrollHeight;

            updateState({
                zoomScale: newScale,
            });
            /*
             * Zoom scales already-rendered canvases with CSS, which softens them past the
             * resolution they were rendered at. Re-render the pages on screen once the zooming
             * settles so they sharpen back up.
             */
            state.zoomRerenderDebounce.execute();

            requestAnimationFrame(() => {
                const {scrollLeft, scrollTop} = computeAnchoredScrollPosition({
                    oldScrollLeft,
                    oldScrollTop,
                    oldScrollWidth,
                    oldScrollHeight,
                    viewWidth,
                    viewHeight,
                    newScrollWidth: scrollContainer.scrollWidth,
                    newScrollHeight: scrollContainer.scrollHeight,
                });
                scrollContainer.scrollLeft = scrollLeft;
                scrollContainer.scrollTop = scrollTop;
            });
        };

        const toolbar =
            inputs.enableZoomControls && pdfReady
                ? html`
                      <div
                          class="zoom-toolbar ${state.isToolbarVisible ? 'visible' : ''}"
                          ${attributes(inputs.attributePassthrough?.['zoom-toolbar'])}
                          style=${ifDefined(inputs.stylePassthrough?.['zoom-toolbar'])}
                      >
                          <button
                              type="button"
                              class="zoom-button"
                              aria-label="Zoom out"
                              ?disabled=${!canZoomOut}
                              ${attributes(inputs.attributePassthrough?.['zoom-button'])}
                              style=${ifDefined(inputs.stylePassthrough?.['zoom-button'])}
                              @click=${() => updateZoom(state.zoomScale / zoomStepFactor)}
                          >
                              <${ViraIcon.assign({
                                  icon: lucideIcons.ZoomOut,
                              })}></${ViraIcon}>
                          </button>
                          <button
                              type="button"
                              class="zoom-button"
                              aria-label="Zoom in"
                              ?disabled=${!canZoomIn}
                              ${attributes(inputs.attributePassthrough?.['zoom-button'])}
                              style=${ifDefined(inputs.stylePassthrough?.['zoom-button'])}
                              @click=${() => updateZoom(state.zoomScale * zoomStepFactor)}
                          >
                              <${ViraIcon.assign({
                                  icon: lucideIcons.ZoomIn,
                              })}></${ViraIcon}>
                          </button>
                          <div class="zoom-divider"></div>
                          <button
                              type="button"
                              class="zoom-button"
                              aria-label="Reset zoom"
                              ?disabled=${!canResetZoom}
                              ${attributes(inputs.attributePassthrough?.['zoom-button'])}
                              style=${ifDefined(inputs.stylePassthrough?.['zoom-button'])}
                              @click=${() => updateZoom(defaultZoomScale)}
                          >
                              <${ViraIcon.assign({
                                  icon: lucideIcons.RotateCcw,
                              })}></${ViraIcon}>
                          </button>
                      </div>
                  `
                : '';

        if (!settled) {
            return html`
                ${toolbar}
                <div class="scroll-container">
                    <div
                        class="loader"
                        ${attributes(inputs.attributePassthrough?.loader)}
                        style=${ifDefined(inputs.stylePassthrough?.loader)}
                    >
                        <${ViraIcon.assign({
                            icon: LoaderAnimated24Icon,
                        })}></${ViraIcon}>
                    </div>
                </div>
            `;
        } else if (settled instanceof Error) {
            return html`
                ${toolbar}
                <div class="scroll-container">
                    <div
                        class="error"
                        ${attributes(inputs.attributePassthrough?.error)}
                        style=${ifDefined(inputs.stylePassthrough?.error)}
                    >
                        PDF load failed: ${extractErrorMessage(settled) || 'Unknown Error'}
                    </div>
                </div>
            `;
        }

        const pdfDocument: PdfDocument = settled;
        const wrapperStyle = css`
            ${cssVars['pdf-vir-zoom-scale'].name}: ${state.zoomScale};
            ${inputs.stylePassthrough?.['canvas-wrapper'] ?? css``}
        `;

        return html`
            ${toolbar}
            <div class="scroll-container">
                ${repeat(
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
                            style=${wrapperStyle}
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

                                    /**
                                     * Zoom level this canvas was last rendered at, or `undefined`
                                     * until its first render.
                                     */
                                    let renderedZoom: undefined | number = undefined;
                                    /**
                                     * Set once a render hits the `maxPixelsPerPage` ceiling, where
                                     * zooming further can't buy any more detail.
                                     */
                                    let isAtMaxResolution = false;
                                    let isRendering = false;

                                    const startRender = async () => {
                                        /*
                                         * Bail when a render is already in flight, or when this
                                         * page already rendered at the current zoom or higher: a
                                         * canvas with more pixels than it needs still looks right
                                         * scaled down, so only zooming in warrants a re-render.
                                         */
                                        if (
                                            isRendering ||
                                            (renderedZoom != undefined &&
                                                (isAtMaxResolution ||
                                                    state.zoomScale <= renderedZoom + epsilon))
                                        ) {
                                            return;
                                        }
                                        /*
                                         * Flagged synchronously so a fast re-fire before the async
                                         * render body runs can't double-schedule this page.
                                         */
                                        isRendering = true;

                                        /*
                                         * Serialize renders across all pages (regardless of page
                                         * order) so simultaneous scroll-ins don't spike memory by
                                         * rendering multiple pages in parallel — and so the shared
                                         * PDFium WASM heap is only touched by one render at a time.
                                         * Each render awaits whatever render was last queued.
                                         */
                                        const pagePromise = new DeferredPromise();
                                        const previousPage = state.lastPagePromise.current;
                                        state.lastPagePromise.current = pagePromise;

                                        try {
                                            await previousPage?.promise;

                                            const maxPixels =
                                                inputs.maxPixelsPerPage ?? defaultMaxPixelsPerPage;
                                            const zoomAtRender = state.zoomScale;
                                            const result = pdfDocument.renderPage({
                                                pageNumber,
                                                canvas,
                                                computeScale({widthPoints, heightPoints}) {
                                                    return computeRenderScale({
                                                        widthPoints,
                                                        heightPoints,
                                                        /*
                                                         * The bounding rect already includes the
                                                         * CSS zoom factor, so a page rendered while
                                                         * zoomed in gets the extra resolution.
                                                         */
                                                        devicePixelWidth:
                                                            canvas.getBoundingClientRect().width *
                                                            (globalThis.devicePixelRatio || 1),
                                                        scaleMultiplier:
                                                            inputs.renderScaleMultiplier ??
                                                            defaultRenderScaleMultiplier,
                                                        maxPixels,
                                                    });
                                                },
                                            });
                                            /*
                                             * Pin the aspect ratio so the page holds its place in
                                             * the scroll layout after eviction drops the canvas to
                                             * zero pixels.
                                             */
                                            canvas.style.aspectRatio = [
                                                result.widthPoints,
                                                result.heightPoints,
                                            ].join(' / ');
                                            renderedZoom = zoomAtRender;
                                            isAtMaxResolution =
                                                result.scale >=
                                                computeMaxRenderScale({
                                                    widthPoints: result.widthPoints,
                                                    heightPoints: result.heightPoints,
                                                    maxPixels,
                                                }) -
                                                    epsilon;
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
                                            isRendering = false;
                                            pagePromise.resolve();
                                        }
                                    };

                                    /**
                                     * Releases this page's canvas pixels. Without this, every page
                                     * the user scrolls past keeps its bitmap for the life of the
                                     * element, and a long document at high zoom exhausts the
                                     * browser's canvas memory — which mobile Safari answers by
                                     * blanking canvases rather than by failing loudly.
                                     */
                                    const evictCanvas = () => {
                                        if (isRendering || renderedZoom == undefined) {
                                            return;
                                        }
                                        canvas.width = 0;
                                        canvas.height = 0;
                                        renderedZoom = undefined;
                                        isAtMaxResolution = false;
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
                                            isVisible = entries.some(
                                                (entry) => entry.isIntersecting,
                                            );
                                            if (isVisible) {
                                                renderDebounce.execute();
                                            }
                                        },
                                        {
                                            /*
                                             * Combined with the dwell debounce, this gives a page
                                             * the user slows near a head start before it scrolls
                                             * into view.
                                             */
                                            rootMargin: pageRenderMargin,
                                        },
                                    );
                                    /*
                                     * Observation continues after the page renders (rather than
                                     * disconnecting) so `isVisible` stays accurate for zoom
                                     * re-renders. `startRender` itself skips pages that are
                                     * already rendered at a high enough resolution.
                                     */
                                    state.pageObservers.push(observer);
                                    observer.observe(canvas);

                                    const evictionObserver = new IntersectionObserver(
                                        (entries) => {
                                            if (!entries.some((entry) => entry.isIntersecting)) {
                                                evictCanvas();
                                            }
                                        },
                                        {
                                            rootMargin: pageEvictionMargin,
                                        },
                                    );
                                    state.pageObservers.push(evictionObserver);
                                    evictionObserver.observe(canvas);

                                    state.pageRenderers.push({
                                        render: startRender,
                                        isVisible: () => isVisible,
                                    });
                                })}
                            ></canvas>
                        </div>
                    `,
                )}
            </div>
        `;
    },
});
