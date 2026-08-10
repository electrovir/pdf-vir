import {describe, itCases} from '@augment-vir/test';
import {
    computeDeviceMaxPixelsPerPage,
    computeMaxRenderScale,
    computeRenderScale,
} from './render-scale.js';

/** US letter, the size the default `maxPixelsPerPage` is tuned against. */
const letterPage = {
    widthPoints: 612,
    heightPoints: 792,
};
const defaultMaxPixels = 8_000_000;

describe(computeDeviceMaxPixelsPerPage.name, () => {
    itCases(computeDeviceMaxPixelsPerPage, [
        {
            it: 'gives a high-memory device the full budget',
            input: {
                deviceMemoryGb: 8,
                cpuCoreCount: 10,
            },
            expect: 8_000_000,
        },
        {
            it: 'scales the budget down for a low-memory device',
            input: {
                deviceMemoryGb: 4,
                cpuCoreCount: 10,
            },
            expect: 4_000_000,
        },
        {
            it: 'floors the budget for a very low-memory device',
            input: {
                deviceMemoryGb: 0.5,
                cpuCoreCount: 2,
            },
            expect: 2_000_000,
        },
        {
            it: 'falls back to core count when memory is unreported',
            input: {
                deviceMemoryGb: undefined,
                cpuCoreCount: 4,
            },
            expect: 4_000_000,
        },
        {
            it: 'uses a mid-range budget when the device reports nothing',
            input: {
                deviceMemoryGb: undefined,
                cpuCoreCount: undefined,
            },
            expect: 4_000_000,
        },
    ]);
});

describe(computeMaxRenderScale.name, () => {
    itCases(computeMaxRenderScale, [
        {
            it: 'allows about 4x on a letter page at the default cap',
            input: {
                ...letterPage,
                maxPixels: defaultMaxPixels,
            },
            expect: 4.062624578484059,
        },
        {
            it: 'allows less scale on a larger page',
            input: {
                widthPoints: 1224,
                heightPoints: 1584,
                maxPixels: defaultMaxPixels,
            },
            expect: 2.0313122892420297,
        },
    ]);
});

describe(computeRenderScale.name, () => {
    itCases(computeRenderScale, [
        {
            it: 'matches the device pixels the canvas occupies',
            input: {
                ...letterPage,
                /** 612 CSS pixels wide on a 2x display. */
                devicePixelWidth: 1224,
                scaleMultiplier: 1,
                maxPixels: defaultMaxPixels,
            },
            expect: 2,
        },
        {
            it: 'scales below 1 for a page displayed smaller than its point size',
            input: {
                ...letterPage,
                devicePixelWidth: 306,
                scaleMultiplier: 1,
                maxPixels: defaultMaxPixels,
            },
            expect: 0.5,
        },
        {
            it: 'applies the multiplier on top of the display size',
            input: {
                ...letterPage,
                devicePixelWidth: 1224,
                scaleMultiplier: 1.5,
                maxPixels: defaultMaxPixels,
            },
            expect: 3,
        },
        {
            it: 'caps the scale so the canvas stays within the pixel budget',
            input: {
                ...letterPage,
                /** Far more than the cap allows: a deep zoom on a high-density display. */
                devicePixelWidth: 12_240,
                scaleMultiplier: 1,
                maxPixels: defaultMaxPixels,
            },
            expect: 4.062624578484059,
        },
        {
            it: 'falls back to a high-density guess when the canvas has no laid-out width',
            input: {
                ...letterPage,
                devicePixelWidth: 0,
                scaleMultiplier: 1,
                maxPixels: defaultMaxPixels,
            },
            expect: 2,
        },
    ]);
});
