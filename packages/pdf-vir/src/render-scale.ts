import {clamp} from '@augment-vir/common';

/**
 * Scale used when the canvas has not been laid out yet, so its on-screen width is still 0. Matches
 * the device pixel ratio of typical high-density displays, which is a better guess than the 1 pixel
 * per point that would otherwise render a 72 DPI page.
 */
const unmeasuredRenderScale = 2;

/**
 * Pixel budget for a device that reports nothing about its capabilities. Deliberately mid-range:
 * guessing high risks blank pages on phones, where the browser drops canvas bitmaps once total
 * canvas memory runs out.
 */
const unknownDeviceMaxPixels = 4_000_000;
/** ~8MB of canvas memory per page, about 2x scale on a US letter page. */
const minDeviceMaxPixels = 2_000_000;
/** ~32MB of canvas memory per page, about 4x scale on a US letter page. */
const maxDeviceMaxPixels = 8_000_000;

/**
 * Picks a per-page pixel budget from what the browser reports about the device, so a low-memory
 * phone doesn't get the same 32MB-per-page allowance as a desktop.
 *
 * Memory is the better signal and is used when present. `navigator.deviceMemory` is Chromium-only,
 * so core count stands in elsewhere (Safari reports cores but not memory), and a device that
 * reports neither gets {@link unknownDeviceMaxPixels}.
 *
 * @category Internal
 */
export function computeDeviceMaxPixelsPerPage({
    deviceMemoryGb,
    cpuCoreCount,
}: {
    deviceMemoryGb: number | undefined;
    cpuCoreCount: number | undefined;
}): number {
    const reported = deviceMemoryGb ?? cpuCoreCount;
    if (reported == undefined) {
        return unknownDeviceMaxPixels;
    }

    /*
     * 1 million pixels per reported GB (or per core) lands 8GB / 8-core devices at the maximum and
     * 2GB / dual-core devices at the minimum.
     */
    return clamp(reported * 1_000_000, {
        min: minDeviceMaxPixels,
        max: maxDeviceMaxPixels,
    });
}

/**
 * The largest scale a page can render at while keeping its canvas pixel buffer (width × height × 4
 * bytes) within `maxPixels`.
 *
 * @category Internal
 */
export function computeMaxRenderScale({
    widthPoints,
    heightPoints,
    maxPixels,
}: {
    widthPoints: number;
    heightPoints: number;
    maxPixels: number;
}): number {
    return Math.sqrt(maxPixels / (widthPoints * heightPoints));
}

/**
 * Computes canvas pixels per PDF point (1/72 inch) for a page render.
 *
 * Targets one canvas pixel per device pixel the canvas actually occupies on screen, so pages stay
 * sharp on high-density displays instead of being rendered at 72 DPI and stretched by the browser.
 * `scaleMultiplier` renders above that target, and `maxPixels` caps the result so a large page or a
 * deep zoom cannot blow up canvas memory.
 *
 * @category Internal
 */
export function computeRenderScale({
    widthPoints,
    heightPoints,
    devicePixelWidth,
    scaleMultiplier,
    maxPixels,
}: {
    widthPoints: number;
    heightPoints: number;
    /** On-screen width of the canvas in device pixels (CSS pixels × `devicePixelRatio`). */
    devicePixelWidth: number;
    scaleMultiplier: number;
    maxPixels: number;
}): number {
    const targetScale =
        devicePixelWidth > 0
            ? (devicePixelWidth / widthPoints) * scaleMultiplier
            : unmeasuredRenderScale;

    return Math.min(
        targetScale,
        computeMaxRenderScale({
            widthPoints,
            heightPoints,
            maxPixels,
        }),
    );
}
