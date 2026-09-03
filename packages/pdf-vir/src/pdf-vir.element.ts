import {assert, check} from '@augment-vir/assert';
import {
    clamp,
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
import {
    computePageLayout,
    computePageSpacerHeights,
    computePageWindow,
    getPageAspectRatio,
    type PagePointSize,
} from './page-layout.js';
import {loadPdfDocument, type PdfDocument} from './pdf-document.js';
import {type PdfSource, toPdfSourceKey} from './pdf-source.js';
import {
    computeDeviceMaxPixelsPerPage,
    computeMaxRenderScale,
    computeRenderScale,
} from './render-scale.js';
import {computeAnchoredScrollPosition, isPointInPaddedRect} from './zoom-util.js';

// cspell:word dppx

export {type PagePointSize} from './page-layout.js';
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
 * How far outside the viewport a page stays in the DOM. Beyond this, the page's canvas is removed
 * and replaced by empty space of the same height, and it re-renders from scratch if the user
 * scrolls back. Must stay comfortably wider than {@link pageRenderMarginPx} so a page isn't
 * unmounted and re-rendered repeatedly by small scrolls.
 */
const pageMountMarginPx = 1500;
/**
 * How far ahead of the viewport a page starts rendering, giving it a head start before the user
 * reaches it, and how far past the viewport it keeps its pixels before they're thrown away.
 *
 * This is what bounds total canvas memory. `maxPixelsPerPage` caps one page, but a canvas holds its
 * pixels for as long as it exists, so without a bound on how many hold pixels at once, total canvas
 * memory grows with the viewport height — and a browser that runs out doesn't throw, it silently
 * blanks bitmaps. This margin keeps that count to what the viewport shows plus roughly one more
 * screen's worth, whatever size the screen is.
 *
 * Must stay below {@link pageMountMarginPx}, since a page can't render before it is in the DOM.
 */
const pageRenderMarginPx = 500;
/**
 * How many times a single page canvas may fail to render before it is left blank. Small on purpose:
 * this only exists to let a page that lost a race for memory try again, not to keep hammering a
 * page PDFium can't draw.
 */
const maxRenderAttempts = 3;
/** Vertical space between pages. Shared by the CSS and the scroll-space math, which must agree. */
const pageGapPx = 32;
/**
 * Padding around the scrolling page list. Shared by the CSS and the scroll-space math, which must
 * agree.
 */
const scrollPaddingPx = 32;
/**
 * How long a change in render resolution must settle before visible pages re-render. Long enough
 * that clicking zoom in several times in a row only triggers one round of renders.
 */
const rerenderDelay: AnyDuration = {
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
export type PageEntry = {
    /** Renders the page, unless it already rendered at the current zoom level or higher. */
    render: () => Promise<void>;
    /**
     * Waits for the page to stay within the render margin before rendering it, so scrolling
     * straight past a page doesn't render it.
     */
    renderDebounce: Debounce;
    /**
     * Throws away the page's pixels while leaving its canvas in place to hold the scroll space, and
     * marks it as needing a fresh render. Called once the page leaves the render margin.
     */
    evict: () => void;
    /**
     * Marks the page's pixels as too coarse for the current display without discarding them, so it
     * re-renders while continuing to show what it already has.
     */
    invalidateResolution: () => void;
    /** Whether the page is currently within the viewport's render margin. */
    isVisible: boolean;
    /** Zero-based index of the page this canvas shows, used to drop entries once it unmounts. */
    pageIndex: number;
};

/**
 * Watches a `.scroll-container` for anything that changes which pages belong in the DOM: scrolling,
 * and the container being resized. Replaces whatever was watching the previous container, since
 * `render` creates a fresh one whenever it switches between the loader, the error, and the pages.
 */
function watchScrollContainer({
    scrollContainer,
    scrollWatchers,
    refresh,
}: {
    scrollContainer: HTMLElement;
    scrollWatchers: {
        listeners: undefined | AbortController;
        resizeObserver: undefined | ResizeObserver;
        pendingFrame: undefined | number;
    };
    refresh: () => void;
}): void {
    scrollWatchers.listeners?.abort();
    scrollWatchers.resizeObserver?.disconnect();

    const abortController = new AbortController();
    scrollWatchers.listeners = abortController;

    /*
     * Scroll events fire far faster than the page window can meaningfully change, so collapse a
     * burst of them into one measurement per frame.
     */
    const requestRefresh = () => {
        if (scrollWatchers.pendingFrame != undefined) {
            return;
        }
        scrollWatchers.pendingFrame = requestAnimationFrame(() => {
            scrollWatchers.pendingFrame = undefined;
            refresh();
        });
    };

    scrollContainer.addEventListener('scroll', requestRefresh, {
        passive: true,
        signal: abortController.signal,
    });
    scrollWatchers.resizeObserver = new ResizeObserver(requestRefresh);
    scrollWatchers.resizeObserver.observe(scrollContainer);
    refresh();
}

/**
 * Builds the observer that decides which pages render and which lose their pixels, rooted at the
 * scrolling page list. Replaces whatever observer came before it, since `render` builds a fresh
 * `.scroll-container` whenever it switches between the loader, the error, and the pages.
 *
 * Rooting it at the container is what makes {@link pageRenderMarginPx} mean anything. An observer
 * left on its default root measures against the browser viewport, and a page below the container's
 * bottom edge is clipped away by the container's own overflow before the root margin is ever
 * applied — so every page past that edge reports as not intersecting no matter how wide the margin
 * is, and pages only ever render once they're already on screen.
 *
 * Canvases already in the DOM are re-registered here, so it doesn't matter whether they or their
 * container were created first.
 */
function watchPageVisibility({
    scrollContainer,
    pageObserver,
    pageEntries,
}: {
    scrollContainer: HTMLElement;
    pageObserver: {current: undefined | IntersectionObserver};
    pageEntries: ReadonlyMap<Element, PageEntry>;
}): void {
    pageObserver.current?.disconnect();

    const observer = new IntersectionObserver(
        (observerEntries) => {
            observerEntries.forEach((observerEntry) => {
                const pageEntry = pageEntries.get(observerEntry.target);
                if (!pageEntry) {
                    return;
                }
                pageEntry.isVisible = observerEntry.isIntersecting;
                if (observerEntry.isIntersecting) {
                    pageEntry.renderDebounce.execute();
                } else {
                    pageEntry.evict();
                }
            });
        },
        {
            root: scrollContainer,
            /*
             * Combined with the dwell debounce, this gives a page the user slows near a head start
             * before it scrolls into view. Leaving this margin is also what costs a page its
             * pixels, keeping total canvas memory bounded.
             */
            rootMargin: `${pageRenderMarginPx}px`,
        },
    );

    pageObserver.current = observer;
    pageEntries.forEach((_pageEntry, canvas) => {
        observer.observe(canvas);
    });
}

/**
 * Calls `onChange` when the window moves to a display of a different pixel density. Pages are
 * rendered at one canvas pixel per device pixel, so a density change leaves every already-rendered
 * page soft until it re-renders.
 *
 * There is no `devicePixelRatio` event to listen to. A media query pinned to the current ratio
 * stands in for one: it stops matching the moment the ratio moves, and since the query only covers
 * the ratio it was built for, each change arms a fresh one.
 *
 * This does not cover browser zoom, which changes `devicePixelRatio` without firing the query. The
 * resize path handles that case, since zooming always resizes the layout viewport.
 */
function watchDevicePixelRatio({
    onChange,
    signal,
}: {
    onChange: () => void;
    signal: AbortSignal;
}): void {
    const watchCurrentRatio = () => {
        if (signal.aborted) {
            return;
        }
        globalThis
            .matchMedia(`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`)
            .addEventListener(
                'change',
                () => {
                    watchCurrentRatio();
                    onChange();
                },
                {
                    once: true,
                    signal,
                },
            );
    };

    watchCurrentRatio();
}

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
    styles: ({cssVars}) => {
        return css`
            :host {
                background-color: ${
                    /**
                     * Use the default value because we don't want the background changing in dark
                     * mode: the PDF white background won't change when switching to dark mode.
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
                padding: ${scrollPaddingPx}px;
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
                gap: ${pageGapPx}px;
                overflow-y: scroll;
                overflow-x: auto;
            }

            .page-spacer {
                width: 100%;
                /*
             * Holds open the scroll space for the pages that aren't in the DOM. Not shrinking is
             * the whole point: these have no content, so nothing else would stop the column from
             * squeezing them to nothing and collapsing the scrollbar.
             */
                flex-shrink: 0;
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
        `;
    },
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
        /**
         * The document the async prop most recently finished loading. The async prop can't be used
         * to find it: `settledValue` reverts to `undefined` the instant a new source starts
         * loading, so by the time `render` notices the source changed there is nothing left to free
         * and the old document's PDFium handles and byte buffer leak for the life of the page.
         */
        const loadedDocument = {
            current: undefined as undefined | PdfDocument,
        };

        return {
            loadedDocument,
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
             * mouse listeners and the device-pixel-ratio watcher. Wrapped in an object so the
             * `current` field can be mutated without going through `updateState` (this is
             * non-reactive lifecycle state).
             */
            hostListeners: {
                current: undefined as undefined | AbortController,
            },
            /**
             * Holder for the tail of this element's render queue. Each page's render awaits this
             * before starting and replaces it with its own promise. A single ref instead of an
             * array keeps memory bounded across long sessions on large documents.
             *
             * This is not what keeps renders from overlapping — `renderPage` runs to completion
             * synchronously, so nothing can interleave with it anyway. What the queue buys is a
             * point where a page that was queued behind several others can notice, before spending
             * anything, that the user has since scrolled past it.
             */
            lastPagePromise: {
                current: undefined as undefined | DeferredPromise,
            },
            lastSourceKey: undefined as undefined | string,
            /**
             * One entry per page canvas currently in the DOM, keyed by that canvas so the shared
             * intersection observer can find a page's state from the entry it's handed.
             */
            pageEntries: new Map<Element, PageEntry>(),
            rerenderDebounce: new Debounce(DebounceStyle.AfterWait, rerenderDelay),
            /**
             * Holder for the observer every mounted page canvas is registered with, rebuilt for
             * each new `.scroll-container` because that container is its root. One instance
             * watching the mounted pages costs far less than one instance per page.
             */
            pageObserver: {
                current: undefined as undefined | IntersectionObserver,
            },
            /**
             * Every page's size in points, read once per document. Each entry is `undefined` when
             * PDFium couldn't report that page's size. Reading them up front matters because they
             * drive the scroll-space math, which re-runs on every scroll.
             */
            pageSizes: {
                current: undefined as undefined | ReadonlyArray<undefined | PagePointSize>,
            },
            /**
             * The range of pages currently in the DOM. Only these pages exist as elements; the rest
             * of the document is two empty placeholders holding open the scroll space. A long
             * document would otherwise pay for every page's layout, and every page's observer
             * registration, before drawing a single pixel.
             */
            pageWindow: {
                firstIndex: 0,
                lastIndex: 0,
            },
            /**
             * Latest measurements of the scrolling page list, refreshed on scroll and resize. Held
             * outside of reactive state so scrolling only re-renders when it actually changes which
             * pages are mounted.
             */
            scrollMetrics: {
                current: {
                    /** Relative to the top of the first page, not the padded scroll box. */
                    scrollTop: 0,
                    viewHeight: 0,
                    /** Width available to one page at zoom 1, in CSS pixels. */
                    contentWidth: 0,
                },
            },
            /**
             * The `devicePixelRatio` the mounted pages were rendered against, checked on every
             * scroll and resize to catch browser zoom.
             */
            renderedDevicePixelRatio: {
                current: globalThis.devicePixelRatio || 1,
            },
            /**
             * Recomputes which pages belong in the DOM from the current scroll position. Assigned
             * in `init`; held here so the scroll and resize listeners, which are attached to a
             * `.scroll-container` that `render` may replace, always reach the live implementation.
             */
            refreshPageWindow: {
                /** Undefined until `init` runs and again after `cleanup`. */
                current: undefined as undefined | (() => void),
            },
            /**
             * Holders for what watches the scrolling page list. Both are replaced whenever `render`
             * creates a new `.scroll-container`, and released in `cleanup`.
             */
            scrollWatchers: {
                listeners: undefined as undefined | AbortController,
                resizeObserver: undefined as undefined | ResizeObserver,
                pendingFrame: undefined as undefined | number,
            },
            pdfDocument: asyncProp({
                async updateCallback({
                    pdfSource,
                    pdfiumWasmUrl,
                }: {
                    pdfSource: PdfSource;
                    pdfiumWasmUrl: string;
                    /**
                     * Not read here. Present so that a change in source identity always counts as a
                     * parameter change: see the comment where these parameters are passed.
                     */
                    sourceKey: string;
                }) {
                    try {
                        const pdfDocument = await loadPdfDocument({
                            source: pdfSource,
                            pdfiumWasmUrl,
                        });
                        /*
                         * Covers the orderings `render` can't: a source changed twice before the
                         * first load finished, so the document that needs freeing never became the
                         * settled value at all.
                         */
                        destroyPdfDocument(loadedDocument.current);
                        loadedDocument.current = pdfDocument;
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

        state.rerenderDebounce.callback = () => {
            /*
             * Re-render only what the user is looking at. Off-screen pages pick up the new
             * resolution from the render observer when they scroll back in.
             */
            state.pageEntries.forEach((pageEntry) => {
                if (pageEntry.isVisible) {
                    void pageEntry.render();
                }
            });
        };

        /**
         * Marks every mounted page as rendered at the wrong resolution and re-renders the visible
         * ones. They keep the pixels they have until the new ones land, so the view doesn't blank.
         */
        function handleDevicePixelRatioChange() {
            state.renderedDevicePixelRatio.current = globalThis.devicePixelRatio || 1;
            state.pageEntries.forEach((pageEntry) => {
                pageEntry.invalidateResolution();
            });
            state.rerenderDebounce.execute();
        }

        state.refreshPageWindow.current = () => {
            /*
             * Browser zoom changes `devicePixelRatio` without firing the media query that
             * `watchDevicePixelRatio` relies on, but it can't change it without also resizing the
             * layout viewport, which lands here. Comparing a number on every scroll frame costs
             * nothing next to the layout math below.
             */
            if (state.renderedDevicePixelRatio.current !== (globalThis.devicePixelRatio || 1)) {
                handleDevicePixelRatioChange();
            }

            const pageSizes = state.pageSizes.current;
            const scrollContainer = host.shadowRoot.querySelector('.scroll-container');
            if (!pageSizes || !(scrollContainer instanceof HTMLElement)) {
                return;
            }

            /*
             * A page's laid-out width is this content width times the zoom factor, matching the
             * `.canvas-wrapper` width rule. Measuring a wrapper directly would be circular: which
             * wrappers exist is what this decides.
             */
            const contentWidth = Math.max(0, scrollContainer.clientWidth - scrollPaddingPx * 2);
            if (!contentWidth) {
                /*
                 * Nothing is laid out yet, so every page height would come out as 0 and the window
                 * would swallow the whole document. Leave the window alone and wait for the resize
                 * observer to report a real width.
                 */
                return;
            }
            state.scrollMetrics.current = {
                scrollTop: scrollContainer.scrollTop - scrollPaddingPx,
                viewHeight: scrollContainer.clientHeight,
                contentWidth,
            };

            const pageWindow = computePageWindow({
                layout: computePageLayout({
                    pageSizes,
                    pageWidth: contentWidth * state.zoomScale,
                    gap: pageGapPx,
                }),
                scrollTop: state.scrollMetrics.current.scrollTop,
                viewHeight: state.scrollMetrics.current.viewHeight,
                overscan: pageMountMarginPx,
            });

            if (
                pageWindow.firstIndex !== state.pageWindow.firstIndex ||
                pageWindow.lastIndex !== state.pageWindow.lastIndex
            ) {
                updateState({
                    pageWindow,
                });
            }
        };

        const abortController = new AbortController();
        state.hostListeners.current = abortController;
        const listenerOptions = {
            signal: abortController.signal,
        };

        watchDevicePixelRatio({
            signal: abortController.signal,
            onChange: handleDevicePixelRatioChange,
        });

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
        state.pageObserver.current?.disconnect();
        state.pageEntries.forEach((pageEntry) => {
            pageEntry.renderDebounce.callback = undefined;
        });
        state.pageEntries.clear();
        state.scrollWatchers.listeners?.abort();
        state.scrollWatchers.resizeObserver?.disconnect();
        if (state.scrollWatchers.pendingFrame != undefined) {
            cancelAnimationFrame(state.scrollWatchers.pendingFrame);
        }
        state.refreshPageWindow.current = undefined;
        state.toolbarHideDebounce.callback = undefined;
        state.rerenderDebounce.callback = undefined;
        state.hostListeners.current?.abort();
        destroyPdfDocument(state.loadedDocument.current);
        /*
         * A load still in flight has no document to free yet, so catch it when it lands. Without
         * this, removing the element before its PDF finishes loading leaks the whole document.
         */
        state.pdfDocument.promiseValue.then(destroyPdfDocument).catch(() => {
            /* A failed load has nothing to free. */
        });
    },
    render({state, updateState, inputs, dispatch, events, host, cssVars}) {
        const pdfSource = inputs.pdfSource;
        const sourceKey = toPdfSourceKey(pdfSource);
        /*
         * `sourceKey` is what decides whether the PDF reloads. The async prop compares parameters
         * by deep equality, which can't tell two `URL`s apart (they carry no own properties) and
         * compares two typed arrays by content — so without this, swapping in a different `URL`
         * would leave the previous document on screen under the new source's page keys.
         * `pdfiumWasmUrl` is stringified for the same reason.
         */
        state.pdfDocument.update({
            sourceKey,
            pdfSource,
            pdfiumWasmUrl: String(inputs.pdfiumWasmUrl),
        });
        if (sourceKey !== state.lastSourceKey) {
            destroyPdfDocument(state.loadedDocument.current);
            state.loadedDocument.current = undefined;
            /*
             * The observer outlives the document, so drop the old document's canvases from it
             * rather than disconnecting: the new document's canvases register on creation.
             */
            state.pageEntries.forEach((pageEntry, canvas) => {
                pageEntry.renderDebounce.callback = undefined;
                state.pageObserver.current?.unobserve(canvas);
            });
            state.pageEntries.clear();
            state.pageSizes.current = undefined;
            state.lastPagePromise.current = undefined;
            updateState({
                lastSourceKey: sourceKey,
                /*
                 * Reset zoom + toolbar visibility so a fresh PDF doesn't inherit prior viewing
                 * state — switching documents at 4x and seeing the new one already zoomed-in is
                 * surprising.
                 */
                zoomScale: defaultZoomScale,
                isToolbarVisible: false,
                /* Start the new document at its first page rather than the old one's scroll spot. */
                pageWindow: {
                    firstIndex: 0,
                    lastIndex: 0,
                },
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
            const newScale = clamp(next, {
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
            state.rerenderDebounce.execute();

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
                /*
                 * Zoom changes both how tall each page is and how many fit on screen. Assigning the
                 * scroll position usually fires a scroll event that would refresh the window
                 * anyway, but not when the anchored position lands exactly where it already was.
                 */
                state.refreshPageWindow.current?.();
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
        if (!state.pageSizes.current) {
            state.pageSizes.current = createArray(pdfDocument.pageCount, (index) => {
                return pdfDocument.getPageSize(index + 1);
            });
        }
        const wrapperStyle = css`
            ${cssVars['pdf-vir-zoom-scale'].name}: ${state.zoomScale};
            ${inputs.stylePassthrough?.['canvas-wrapper'] ?? css``}
        `;

        const pageWindow = state.pageWindow;
        const spacers = computePageSpacerHeights({
            layout: computePageLayout({
                pageSizes: state.pageSizes.current,
                pageWidth: state.scrollMetrics.current.contentWidth * state.zoomScale,
                gap: pageGapPx,
            }),
            firstIndex: pageWindow.firstIndex,
            lastIndex: pageWindow.lastIndex,
            gap: pageGapPx,
        });
        /*
         * Drop the state of pages that just left the window. Their canvases are gone from the DOM,
         * so without this the observer would keep them alive and keep reporting on them forever.
         */
        state.pageEntries.forEach((pageEntry, canvas) => {
            if (
                pageEntry.pageIndex < pageWindow.firstIndex ||
                pageEntry.pageIndex > pageWindow.lastIndex
            ) {
                pageEntry.renderDebounce.callback = undefined;
                state.pageObserver.current?.unobserve(canvas);
                state.pageEntries.delete(canvas);
            }
        });

        return html`
            ${toolbar}
            <div
                class="scroll-container"
                ${onDomCreated((scrollContainer) => {
                    assert.instanceOf(scrollContainer, HTMLElement);
                    watchPageVisibility({
                        scrollContainer,
                        pageObserver: state.pageObserver,
                        pageEntries: state.pageEntries,
                    });
                    watchScrollContainer({
                        scrollContainer,
                        scrollWatchers: state.scrollWatchers,
                        refresh: () => state.refreshPageWindow.current?.(),
                    });
                })}
            >
                ${spacers.aboveHeight
                    ? html`
                          <div
                              class="page-spacer"
                              style=${css`
                                  height: ${spacers.aboveHeight}px;
                              `}
                          ></div>
                      `
                    : ''}
                ${repeat(
                    createArray(
                        Math.max(0, pageWindow.lastIndex - pageWindow.firstIndex + 1),
                        (offset) => pageWindow.firstIndex + offset,
                    ),
                    (index) => {
                        return [
                            sourceKey,
                            index,
                        ].join(':');
                    },
                    (index) => {
                        /*
                         * Give the canvas its page's shape before anything renders, so the scroll
                         * layout is right from the start instead of every page shifting as it
                         * draws. This is also what holds the page's place while it has no pixels,
                         * both before its first render and after eviction throws them away.
                         *
                         * This lives in the template rather than being assigned to `canvas.style`
                         * because lit rewrites the whole `style` attribute on every render when
                         * the bound value isn't a primitive, wiping out anything set imperatively.
                         */
                        const canvasStyle = css`
                            aspect-ratio: ${getPageAspectRatio(state.pageSizes.current?.[index])};
                            ${inputs.stylePassthrough?.canvas ?? css``}
                        `;

                        return html`
                            <div
                                class="canvas-wrapper"
                                ${attributes(inputs.attributePassthrough?.['canvas-wrapper'])}
                                style=${wrapperStyle}
                            >
                                <canvas
                                    ${attributes(inputs.attributePassthrough?.canvas)}
                                    style=${canvasStyle}
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
                                         * Zoom level this canvas was last rendered at, or
                                         * `undefined` until its first render.
                                         */
                                        let renderedZoom: undefined | number = undefined;
                                        /**
                                         * Set once a render hits the `maxPixelsPerPage` ceiling,
                                         * where zooming further can't buy any more detail.
                                         */
                                        let isAtMaxResolution = false;
                                        let isRendering = false;
                                        /**
                                         * Renders this page has failed. Counted rather than
                                         * latched: most of the ways a render can throw are failed
                                         * allocations, which is what a device short on memory does
                                         * and which clears up once other pages release theirs. A
                                         * page PDFium genuinely can't draw fails the same way every
                                         * time, so a few attempts separate the two without leaving
                                         * it re-rendering and re-dispatching `pdfError` every time
                                         * it scrolls back into the margin.
                                         */
                                        let failedRenderCount = 0;

                                        const startRender = async () => {
                                            /*
                                             * Bail when a render is already in flight, when this
                                             * page has failed too many times to be worth another
                                             * attempt, or when it already rendered at the current
                                             * zoom or higher: a canvas with more pixels than it
                                             * needs still looks right scaled down, so only zooming
                                             * in warrants a re-render.
                                             */
                                            if (
                                                isRendering ||
                                                failedRenderCount >= maxRenderAttempts ||
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
                                             * Queue behind whatever render was last queued, so a
                                             * burst of pages scrolling in at once renders one at a
                                             * time and each one gets to re-check below whether it's
                                             * still worth drawing.
                                             */
                                            const pagePromise = new DeferredPromise();
                                            const previousPage = state.lastPagePromise.current;
                                            state.lastPagePromise.current = pagePromise;

                                            try {
                                                await previousPage?.promise;

                                                /*
                                                 * Two things can happen while this render waits its
                                                 * turn, and neither leaves anything worth rendering:
                                                 * the source can change, which destroys the document
                                                 * this closure captured, and the page can scroll out
                                                 * of the render margin, which means its pixels would
                                                 * be evicted about as soon as they were drawn.
                                                 * Either way, rendering anyway would cost a full
                                                 * PDFium render and a full-frame buffer while holding
                                                 * the queue ahead of the page the user is looking at.
                                                 */
                                                if (
                                                    sourceKey !== state.lastSourceKey ||
                                                    !pageEntry.isVisible
                                                ) {
                                                    return;
                                                }

                                                const maxPixels =
                                                    inputs.maxPixelsPerPage ??
                                                    defaultMaxPixelsPerPage;
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
                                                                canvas.getBoundingClientRect()
                                                                    .width *
                                                                (globalThis.devicePixelRatio || 1),
                                                            scaleMultiplier:
                                                                inputs.renderScaleMultiplier ??
                                                                defaultRenderScaleMultiplier,
                                                            maxPixels,
                                                        });
                                                    },
                                                });
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
                                                failedRenderCount++;
                                                dispatch(new events.pdfError(ensureError(error)));
                                            } finally {
                                                isRendering = false;
                                                pagePromise.resolve();
                                            }
                                        };

                                        /*
                                         * Debounce scroll-through: the first time the page enters the
                                         * prefetch window, schedule a fire 150ms later. When that fire
                                         * lands, render only if the page is still visible — fast scrolls
                                         * leave `isVisible` false at fire time, so those pages are skipped.
                                         */
                                        const pageEntry: PageEntry = {
                                            render: startRender,
                                            pageIndex: index,
                                            isVisible: false,
                                            invalidateResolution() {
                                                renderedZoom = undefined;
                                                isAtMaxResolution = false;
                                            },
                                            evict() {
                                                pageEntry.invalidateResolution();
                                                /*
                                                 * A zero-pixel canvas has no bitmap to hold. The
                                                 * element stays in place and keeps its scroll space
                                                 * from the `aspect-ratio` in its style, so nothing
                                                 * shifts — the page just goes blank until it
                                                 * re-renders on the way back.
                                                 */
                                                canvas.width = 0;
                                                canvas.height = 0;
                                            },
                                            renderDebounce: new Debounce(
                                                DebounceStyle.AfterWait,
                                                {
                                                    milliseconds: 150,
                                                },
                                                () => {
                                                    if (pageEntry.isVisible) {
                                                        void startRender();
                                                    }
                                                },
                                            ),
                                        };
                                        state.pageEntries.set(canvas, pageEntry);
                                        /*
                                         * Observation continues after the page renders (rather than
                                         * unobserving): leaving the margin is what evicts the
                                         * page's pixels, and `isVisible` has to stay accurate for
                                         * re-renders. `startRender` itself skips pages that are
                                         * already rendered at a high enough resolution.
                                         */
                                        state.pageObserver.current?.observe(canvas);
                                    })}
                                ></canvas>
                            </div>
                        `;
                    },
                )}
                ${spacers.belowHeight
                    ? html`
                          <div
                              class="page-spacer"
                              style=${css`
                                  height: ${spacers.belowHeight}px;
                              `}
                          ></div>
                      `
                    : ''}
            </div>
        `;
    },
});
