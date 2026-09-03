/** Aspect ratio used for a page whose size PDFium couldn't report. */
const fallbackPageRatio = 8.5 / 11;

/**
 * A page's intrinsic size in PDF points (1/72 inch).
 *
 * @category Internal
 */
export type PagePointSize = {
    widthPoints: number;
    heightPoints: number;
};

/**
 * A page's width-to-height ratio, falling back to US letter for a page whose size PDFium couldn't
 * report. Shared by the scroll-space math and the canvas's CSS `aspect-ratio`, which have to agree
 * or pages shift around as they render.
 *
 * @category Internal
 */
export function getPageAspectRatio(pageSize: undefined | PagePointSize): number {
    return pageSize && pageSize.widthPoints > 0 && pageSize.heightPoints > 0
        ? pageSize.widthPoints / pageSize.heightPoints
        : fallbackPageRatio;
}

/**
 * Where every page sits vertically in the scroll container, in CSS pixels. Only a slice of these
 * pages is ever in the DOM, so this is what tells the element which slice to mount and how much
 * empty space to leave in place of the rest.
 *
 * @category Internal
 */
export type PageLayout = {
    /** Each page's distance from the top of the first page. */
    tops: ReadonlyArray<number>;
    /** Each page's laid-out height. */
    heights: ReadonlyArray<number>;
    /** Distance from the top of the first page to the bottom of the last, gaps included. */
    totalHeight: number;
};

/**
 * Lays out every page of a document vertically, so the element can leave the right amount of scroll
 * space for the pages it hasn't put in the DOM.
 *
 * @category Internal
 */
export function computePageLayout({
    pageSizes,
    pageWidth,
    gap,
}: {
    pageSizes: ReadonlyArray<undefined | PagePointSize>;
    /** Laid-out width of a single page in CSS pixels, zoom included. */
    pageWidth: number;
    /** Vertical space between two pages in CSS pixels. */
    gap: number;
}): PageLayout {
    const heights = pageSizes.map((pageSize) => {
        return pageWidth / getPageAspectRatio(pageSize);
    });

    /*
     * A running total rather than summing each page's predecessors: this walks every page in the
     * document, which is exactly the per-page cost that mounting only a slice of them exists to
     * avoid.
     */
    const tops: number[] = [];
    heights.forEach((_height, index) => {
        tops.push(index === 0 ? 0 : (tops[index - 1] ?? 0) + (heights[index - 1] ?? 0) + gap);
    });

    return {
        tops,
        heights,
        totalHeight: (tops[tops.length - 1] ?? 0) + (heights[heights.length - 1] ?? 0),
    };
}

/**
 * The inclusive range of pages to keep in the DOM: everything the viewport shows plus `overscan`
 * pixels of runway on each side, so a page is mounted (and has a chance to render) before the user
 * scrolls to it.
 *
 * Always returns a non-empty range for a non-empty document, even when the scroll position falls
 * outside the laid-out pages, which happens for a frame after the layout changes.
 *
 * @category Internal
 */
export function computePageWindow({
    layout,
    scrollTop,
    viewHeight,
    overscan,
}: {
    layout: PageLayout;
    /** Scroll offset of the viewport's top edge, relative to the top of the first page. */
    scrollTop: number;
    viewHeight: number;
    overscan: number;
}): {firstIndex: number; lastIndex: number} {
    if (!layout.tops.length) {
        return {
            firstIndex: 0,
            lastIndex: -1,
        };
    }

    const windowTop = scrollTop - overscan;
    const windowBottom = scrollTop + viewHeight + overscan;
    const firstMatch = layout.tops.findIndex(
        (top, index) => top + (layout.heights[index] ?? 0) >= windowTop,
    );
    const lastMatch = layout.tops.findLastIndex((top) => top <= windowBottom);
    const firstIndex = firstMatch < 0 ? layout.tops.length - 1 : firstMatch;
    const lastIndex = lastMatch < 0 ? 0 : lastMatch;

    return {
        firstIndex: Math.min(firstIndex, lastIndex),
        lastIndex: Math.max(firstIndex, lastIndex),
    };
}

/**
 * Heights of the two placeholders that stand in for the pages above and below the mounted range,
 * keeping the scrollbar the size it would be if every page were in the DOM.
 *
 * Each height is short by one `gap` because the flex layout already puts a gap between the
 * placeholder and its neighboring page. A height of `0` means no placeholder is needed at all.
 *
 * @category Internal
 */
export function computePageSpacerHeights({
    layout,
    firstIndex,
    lastIndex,
    gap,
}: {
    layout: PageLayout;
    firstIndex: number;
    lastIndex: number;
    gap: number;
}): {aboveHeight: number; belowHeight: number} {
    const above = layout.tops[firstIndex] ?? 0;
    const below =
        layout.totalHeight - ((layout.tops[lastIndex] ?? 0) + (layout.heights[lastIndex] ?? 0));

    return {
        aboveHeight: Math.max(0, above - gap),
        belowHeight: Math.max(0, below - gap),
    };
}
