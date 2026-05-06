import {describe, itCases} from '@augment-vir/test';
import {clampZoomScale, computeAnchoredScrollPosition, isPointInPaddedRect} from './zoom-util.js';

describe(clampZoomScale.name, () => {
    const range = {
        min: 0.5,
        max: 4,
    };

    itCases(clampZoomScale, [
        {
            it: 'returns the target unchanged when inside the range',
            inputs: [
                2,
                range,
            ],
            expect: 2,
        },
        {
            it: 'returns the target at the lower bound',
            inputs: [
                range.min,
                range,
            ],
            expect: range.min,
        },
        {
            it: 'returns the target at the upper bound',
            inputs: [
                range.max,
                range,
            ],
            expect: range.max,
        },
        {
            it: 'clamps a value below the lower bound',
            inputs: [
                0.1,
                range,
            ],
            expect: range.min,
        },
        {
            it: 'clamps a value above the upper bound',
            inputs: [
                10,
                range,
            ],
            expect: range.max,
        },
    ]);
});

describe(computeAnchoredScrollPosition.name, () => {
    itCases(computeAnchoredScrollPosition, [
        {
            it: 'centers the scroll when zooming from a fitting layout into overflow',
            input: {
                oldScrollLeft: 0,
                oldScrollTop: 0,
                oldScrollWidth: 600,
                oldScrollHeight: 800,
                viewWidth: 600,
                viewHeight: 800,
                newScrollWidth: 1200,
                newScrollHeight: 1600,
            },
            expect: {
                scrollLeft: 300,
                scrollTop: 400,
            },
        },
        {
            it: 'preserves the visible center when both axes scale uniformly',
            /*
             * Visible center pre-zoom: (oldScrollLeft + viewWidth/2, oldScrollTop + viewHeight/2)
             *   = (200 + 300, 100 + 400) = (500, 500). Ratios: 500/1000 = 0.5, 500/1000 = 0.5.
             * Post-zoom (doubled): scrollLeft = 0.5 * 2000 - 300 = 700; scrollTop = 0.5 * 2000 - 400 = 600.
             */
            input: {
                oldScrollLeft: 200,
                oldScrollTop: 100,
                oldScrollWidth: 1000,
                oldScrollHeight: 1000,
                viewWidth: 600,
                viewHeight: 800,
                newScrollWidth: 2000,
                newScrollHeight: 2000,
            },
            expect: {
                scrollLeft: 700,
                scrollTop: 600,
            },
        },
        {
            it: 'returns negative scroll when zooming out shrinks content below view',
            /*
             * Caller (the browser) is expected to clamp negative scroll positions to 0; the
             * math here is correct — a non-overflowing layout has no scrollable region.
             *
             * centerXRatio = (100 + 300) / 1000 = 0.4 → scrollLeft = 0.4 * 600 - 300 = -60
             * centerYRatio = (50 + 400) / 1000 = 0.45 → scrollTop = 0.45 * 800 - 400 = -40
             */
            input: {
                oldScrollLeft: 100,
                oldScrollTop: 50,
                oldScrollWidth: 1000,
                oldScrollHeight: 1000,
                viewWidth: 600,
                viewHeight: 800,
                newScrollWidth: 600,
                newScrollHeight: 800,
            },
            expect: {
                scrollLeft: -60,
                scrollTop: -40,
            },
        },
    ]);
});

describe(isPointInPaddedRect.name, () => {
    const rect = {
        left: 100,
        top: 100,
        right: 200,
        bottom: 150,
    };

    itCases(isPointInPaddedRect, [
        {
            it: 'returns true when the point is inside the rect',
            input: {
                point: {
                    x: 150,
                    y: 125,
                },
                rect,
                padding: 10,
            },
            expect: true,
        },
        {
            it: 'returns true when the point is inside the padding zone but outside the rect',
            input: {
                point: {
                    x: 95,
                    y: 95,
                },
                rect,
                padding: 10,
            },
            expect: true,
        },
        {
            it: 'returns false when the point is outside the padding zone',
            input: {
                point: {
                    x: 80,
                    y: 80,
                },
                rect,
                padding: 10,
            },
            expect: false,
        },
        {
            it: 'returns true on the exact padding boundary',
            input: {
                point: {
                    x: 90,
                    y: 90,
                },
                rect,
                padding: 10,
            },
            expect: true,
        },
        {
            it: 'collapses to plain rect containment with zero padding',
            input: {
                point: {
                    x: 99,
                    y: 100,
                },
                rect,
                padding: 0,
            },
            expect: false,
        },
    ]);
});
