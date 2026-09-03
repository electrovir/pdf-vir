/**
 * Computes the scroll-container scroll positions that keep the same content point at the visual
 * center of the viewport across a zoom (or any layout change that scales the scroll dimensions).
 * Captures the visible-center as a ratio of the old scroll dimensions, then applies that ratio to
 * the new scroll dimensions and subtracts half the viewport so the center aligns.
 *
 * Both axes are computed independently. When the content fits the viewport (no overflow),
 * `oldScrollWidth` equals `viewWidth` and the ratio collapses to 0.5 — the new scroll position
 * lands at exactly half the new overflow, centering the content in the viewport.
 *
 * @category Internal
 */
export function computeAnchoredScrollPosition({
    oldScrollLeft,
    oldScrollTop,
    oldScrollWidth,
    oldScrollHeight,
    viewWidth,
    viewHeight,
    newScrollWidth,
    newScrollHeight,
}: {
    oldScrollLeft: number;
    oldScrollTop: number;
    oldScrollWidth: number;
    oldScrollHeight: number;
    viewWidth: number;
    viewHeight: number;
    newScrollWidth: number;
    newScrollHeight: number;
}): {scrollLeft: number; scrollTop: number} {
    const centerXRatio = (oldScrollLeft + viewWidth / 2) / oldScrollWidth;
    const centerYRatio = (oldScrollTop + viewHeight / 2) / oldScrollHeight;
    return {
        scrollLeft: centerXRatio * newScrollWidth - viewWidth / 2,
        scrollTop: centerYRatio * newScrollHeight - viewHeight / 2,
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
    point: {x: number; y: number};
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
