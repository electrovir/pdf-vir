import {assert} from '@augment-vir/assert';
import {describe, it, itCases} from '@augment-vir/test';
import {
    computeAnchoredScrollPosition,
    computeScrollAnchorRatio,
    isPointInPaddedRect,
    measurePinch,
} from './zoom-util.js';

describe(computeScrollAnchorRatio.name, () => {
    itCases(computeScrollAnchorRatio, [
        {
            it: 'puts the center of an exactly-fitting axis at the halfway mark when not scrolled',
            input: {
                scrollOffset: 0,
                focalOffset: 300,
                scrollSize: 600,
            },
            expect: 0.5,
        },
        {
            it: 'counts how far the container is already scrolled',
            input: {
                scrollOffset: 200,
                focalOffset: 300,
                scrollSize: 1000,
            },
            expect: 0.5,
        },
        {
            it: 'locates a focal point near the leading edge',
            input: {
                scrollOffset: 0,
                focalOffset: 60,
                scrollSize: 600,
            },
            expect: 0.1,
        },
        {
            it: 'anchors to the start rather than dividing by an axis with no size yet',
            input: {
                scrollOffset: 0,
                focalOffset: 300,
                scrollSize: 0,
            },
            expect: 0,
        },
    ]);
});

describe(computeAnchoredScrollPosition.name, () => {
    itCases(computeAnchoredScrollPosition, [
        {
            it: 'centers the scroll when zooming from a fitting layout into overflow',
            input: {
                scrollRatioX: 0.5,
                scrollRatioY: 0.5,
                focalX: 300,
                focalY: 400,
                newScrollWidth: 1200,
                newScrollHeight: 1600,
            },
            expect: {
                scrollLeft: 300,
                scrollTop: 400,
            },
        },
        {
            it: 'holds an off-center focal point in place, not the viewport center',
            /*
             * A pinch that began near the top left of a 600x800 viewport, on content 0.1 of the
             * way into each axis. Doubling the layout puts that content at (120, 160), so the
             * scroll has to move by (120 - 60, 160 - 80) to leave it under the fingers.
             */
            input: {
                scrollRatioX: 0.1,
                scrollRatioY: 0.1,
                focalX: 60,
                focalY: 80,
                newScrollWidth: 1200,
                newScrollHeight: 1600,
            },
            expect: {
                scrollLeft: 60,
                scrollTop: 80,
            },
        },
        {
            it: 'returns negative scroll when zooming out shrinks content below view',
            /*
             * Caller (the browser) is expected to clamp negative scroll positions to 0; the
             * math here is correct — a non-overflowing layout has no scrollable region.
             */
            input: {
                scrollRatioX: 0.4,
                scrollRatioY: 0.45,
                focalX: 300,
                focalY: 400,
                newScrollWidth: 600,
                newScrollHeight: 800,
            },
            expect: {
                scrollLeft: -60,
                scrollTop: -40,
            },
        },
    ]);

    it('leaves the scroll where it is when the content did not resize', () => {
        /*
         * What a pinch step that changed nothing must do. Measuring and restoring has to be exactly
         * circular, or repeated steps would walk the page across the screen.
         */
        const focalX = 137;
        const focalY = 421;
        const scrollWidth = 1739;
        const scrollHeight = 5081;

        assert.deepEquals(
            computeAnchoredScrollPosition({
                scrollRatioX: computeScrollAnchorRatio({
                    scrollOffset: 613,
                    focalOffset: focalX,
                    scrollSize: scrollWidth,
                }),
                scrollRatioY: computeScrollAnchorRatio({
                    scrollOffset: 2044,
                    focalOffset: focalY,
                    scrollSize: scrollHeight,
                }),
                focalX,
                focalY,
                newScrollWidth: scrollWidth,
                newScrollHeight: scrollHeight,
            }),
            {
                scrollLeft: 613,
                scrollTop: 2044,
            },
        );
    });
});

describe(measurePinch.name, () => {
    itCases(measurePinch, [
        {
            it: 'measures two fingers spread along one axis',
            input: {
                first: {
                    x: 100,
                    y: 200,
                },
                second: {
                    x: 300,
                    y: 200,
                },
            },
            expect: {
                distance: 200,
                midpoint: {
                    x: 200,
                    y: 200,
                },
            },
        },
        {
            it: 'measures a diagonal spread',
            input: {
                first: {
                    x: 0,
                    y: 0,
                },
                second: {
                    x: 30,
                    y: 40,
                },
            },
            expect: {
                distance: 50,
                midpoint: {
                    x: 15,
                    y: 20,
                },
            },
        },
        {
            it: 'does not care which finger came first',
            input: {
                first: {
                    x: 30,
                    y: 40,
                },
                second: {
                    x: 0,
                    y: 0,
                },
            },
            expect: {
                distance: 50,
                midpoint: {
                    x: 15,
                    y: 20,
                },
            },
        },
        {
            it: 'reports zero for two fingers at the same spot',
            /* The caller has to skip this rather than divide by it. */
            input: {
                first: {
                    x: 50,
                    y: 50,
                },
                second: {
                    x: 50,
                    y: 50,
                },
            },
            expect: {
                distance: 0,
                midpoint: {
                    x: 50,
                    y: 50,
                },
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
