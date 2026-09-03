import {assert} from '@augment-vir/assert';
import {createArray} from '@augment-vir/common';
import {describe, it, itCases} from '@augment-vir/test';
import {
    computePageLayout,
    computePageSpacerHeights,
    computePageWindow,
    getPageAspectRatio,
    type PagePointSize,
} from './page-layout.js';

/** US letter in points. At a 600px page width this lays out 776.47px tall. */
const letterPage: PagePointSize = {
    widthPoints: 612,
    heightPoints: 792,
};
const letterHeightAt600 = 600 / (612 / 792);
const gap = 32;

function layoutLetterPages(pageCount: number) {
    return computePageLayout({
        pageSizes: createArray(pageCount, () => letterPage),
        pageWidth: 600,
        gap,
    });
}

describe(getPageAspectRatio.name, () => {
    itCases(getPageAspectRatio, [
        {
            it: 'uses the reported page size',
            input: letterPage,
            expect: 612 / 792,
        },
        {
            it: 'falls back to the letter ratio for an unreported size',
            input: undefined,
            expect: 8.5 / 11,
        },
        {
            it: 'falls back rather than dividing by a zero dimension',
            input: {
                widthPoints: 612,
                heightPoints: 0,
            },
            expect: 8.5 / 11,
        },
    ]);
});

describe(computePageLayout.name, () => {
    itCases(computePageLayout, [
        {
            it: 'stacks pages with a gap between each',
            input: {
                pageSizes: [
                    letterPage,
                    letterPage,
                ],
                pageWidth: 600,
                gap,
            },
            expect: {
                tops: [
                    0,
                    letterHeightAt600 + gap,
                ],
                heights: [
                    letterHeightAt600,
                    letterHeightAt600,
                ],
                totalHeight: letterHeightAt600 * 2 + gap,
            },
        },
        {
            it: 'leaves no gap for a single page',
            input: {
                pageSizes: [letterPage],
                pageWidth: 600,
                gap,
            },
            expect: {
                tops: [0],
                heights: [letterHeightAt600],
                totalHeight: letterHeightAt600,
            },
        },
        {
            it: 'falls back to the letter ratio for a page of unknown size',
            input: {
                pageSizes: [undefined],
                pageWidth: 850,
                gap,
            },
            expect: {
                tops: [0],
                heights: [1100],
                totalHeight: 1100,
            },
        },
        {
            it: 'handles an empty document',
            input: {
                pageSizes: [],
                pageWidth: 600,
                gap,
            },
            expect: {
                tops: [],
                heights: [],
                totalHeight: 0,
            },
        },
    ]);

    it('scales page heights with the page width', () => {
        assert.deepEquals(
            computePageLayout({
                pageSizes: [letterPage],
                pageWidth: 1200,
                gap,
            }).heights,
            [letterHeightAt600 * 2],
        );
    });
});

describe(computePageWindow.name, () => {
    it('mounts only the pages near the viewport in a long document', () => {
        assert.deepEquals(
            computePageWindow({
                layout: layoutLetterPages(1000),
                scrollTop: 0,
                viewHeight: 800,
                overscan: 1500,
            }),
            {
                firstIndex: 0,
                lastIndex: 2,
            },
        );
    });

    it('follows the viewport down the document', () => {
        /** Page 100 starts at 100 * (776.47 + 32) = 80,847px. */
        assert.deepEquals(
            computePageWindow({
                layout: layoutLetterPages(1000),
                scrollTop: 80_847,
                viewHeight: 800,
                overscan: 1500,
            }),
            {
                firstIndex: 98,
                lastIndex: 102,
            },
        );
    });

    it('mounts the last page when scrolled past the end', () => {
        assert.deepEquals(
            computePageWindow({
                layout: layoutLetterPages(10),
                scrollTop: 1_000_000,
                viewHeight: 800,
                overscan: 0,
            }),
            {
                firstIndex: 9,
                lastIndex: 9,
            },
        );
    });

    it('mounts the first page when scrolled above the start', () => {
        assert.deepEquals(
            computePageWindow({
                layout: layoutLetterPages(10),
                scrollTop: -5000,
                viewHeight: 100,
                overscan: 0,
            }),
            {
                firstIndex: 0,
                lastIndex: 0,
            },
        );
    });

    it('reports an empty range for an empty document', () => {
        assert.deepEquals(
            computePageWindow({
                layout: layoutLetterPages(0),
                scrollTop: 0,
                viewHeight: 800,
                overscan: 1500,
            }),
            {
                firstIndex: 0,
                lastIndex: -1,
            },
        );
    });
});

describe(computePageSpacerHeights.name, () => {
    it('reserves the exact space the unmounted pages would occupy', () => {
        const layout = layoutLetterPages(10);
        const spacers = computePageSpacerHeights({
            layout,
            firstIndex: 4,
            lastIndex: 5,
            gap,
        });

        /*
         * The mounted pages plus both spacers plus the flex gaps between all of them must add up to
         * the height the document would have with every page in the DOM. Otherwise the scrollbar
         * would not match the document.
         */
        assert.strictEquals(
            spacers.aboveHeight +
                gap +
                letterHeightAt600 +
                gap +
                letterHeightAt600 +
                gap +
                spacers.belowHeight,
            layout.totalHeight,
        );
    });

    it('needs no spacers when every page is mounted', () => {
        assert.deepEquals(
            computePageSpacerHeights({
                layout: layoutLetterPages(3),
                firstIndex: 0,
                lastIndex: 2,
                gap,
            }),
            {
                aboveHeight: 0,
                belowHeight: 0,
            },
        );
    });
});
