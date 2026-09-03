/**
 * A point in pixels. Which corner it is measured from depends on the function taking it.
 *
 * @category Internal
 */
export type Point = {
    x: number;
    y: number;
};

/**
 * Locates a focal point within the scroll content as a fraction of one scroll dimension, which is
 * the form that survives the content being resized.
 *
 * A zero-sized scroll dimension means nothing is laid out yet; anchoring to the start is the only
 * answer that isn't a division by zero.
 *
 * @category Internal
 */
export function computeScrollAnchorRatio({
    scrollOffset,
    focalOffset,
    scrollSize,
}: {
    /** How far the container is currently scrolled along this axis. */
    scrollOffset: number;
    /** Distance from the viewport's leading edge to the point that should not move. */
    focalOffset: number;
    scrollSize: number;
}): number {
    return scrollSize > 0 ? (scrollOffset + focalOffset) / scrollSize : 0;
}

/**
 * Computes the scroll-container scroll positions that put an anchored content point back under the
 * focal point, once a zoom (or any layout change that scales the scroll dimensions) has resized the
 * content.
 *
 * The focal point is what the user expects to stay still: the middle of the viewport for the zoom
 * buttons, and the point the fingers started at for a pinch.
 *
 * Both axes are computed independently. When the content fits the viewport (no overflow) and the
 * focal point is the viewport center, the ratio is 0.5 — the new scroll position lands at exactly
 * half the new overflow, centering the content in the viewport.
 *
 * @category Internal
 */
export function computeAnchoredScrollPosition({
    scrollRatioX,
    scrollRatioY,
    focalX,
    focalY,
    newScrollWidth,
    newScrollHeight,
}: {
    /** From {@link computeScrollAnchorRatio}, measured before the content was resized. */
    scrollRatioX: number;
    scrollRatioY: number;
    /** Distance from the viewport's left edge to the point that should not move. */
    focalX: number;
    /** Distance from the viewport's top edge to the point that should not move. */
    focalY: number;
    newScrollWidth: number;
    newScrollHeight: number;
}): {scrollLeft: number; scrollTop: number} {
    return {
        scrollLeft: scrollRatioX * newScrollWidth - focalX,
        scrollTop: scrollRatioY * newScrollHeight - focalY,
    };
}

/**
 * The two numbers a pinch gesture is made of: how far apart the fingers are, which drives how far
 * to zoom, and the point halfway between them, which drives what to zoom toward.
 *
 * @category Internal
 */
export function measurePinch({first, second}: {first: Readonly<Point>; second: Readonly<Point>}) {
    return {
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        midpoint: {
            x: (first.x + second.x) / 2,
            y: (first.y + second.y) / 2,
        },
    };
}

/**
 * Tests whether the point `{x, y}` lies inside the rectangle `{left, top, right, bottom}` after
 * expanding the rectangle on every side by `padding`. Used to give the zoom toolbar an extended
 * hover hit-zone so a user lining up a click doesn't watch it auto-hide.
 *
 * @category Internal
 */
export function isPointInPaddedRect({
    point,
    rect,
    padding,
}: {
    point: Readonly<Point>;
    rect: {left: number; top: number; right: number; bottom: number};
    padding: number;
}): boolean {
    return (
        point.x >= rect.left - padding &&
        point.x <= rect.right + padding &&
        point.y >= rect.top - padding &&
        point.y <= rect.bottom + padding
    );
}
