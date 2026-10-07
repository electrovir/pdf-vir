import {assert} from '@augment-vir/assert';
import {omitObjectKeys} from '@augment-vir/common';
import {describe, it, itCases} from '@augment-vir/test';
import {
    createPdfFormField,
    getPdfFormFieldBoxBounds,
    movePdfFormFieldBox,
    movePdfFormFieldBoxes,
    PdfFormFieldType,
    resizePdfFormFieldBox,
} from './pdf-form-field.js';

const baseBox = {
    x: 0.2,
    y: 0.3,
    width: 0.25,
    height: 0.1,
};

describe(movePdfFormFieldBox.name, () => {
    itCases(movePdfFormFieldBox, [
        {
            it: 'moves a box that stays on the page',
            input: {
                box: baseBox,
                deltaX: 0.1,
                deltaY: -0.1,
            },
            expect: {
                ...baseBox,
                x: 0.30000000000000004,
                y: 0.19999999999999998,
            },
        },
        {
            it: 'stops at the page edges',
            input: {
                box: baseBox,
                deltaX: 2,
                deltaY: -2,
            },
            expect: {
                ...baseBox,
                x: 0.75,
                y: 0,
            },
        },
    ]);
});

describe(movePdfFormFieldBoxes.name, () => {
    itCases(movePdfFormFieldBoxes, [
        {
            it: 'moves every box by the same amount',
            input: {
                boxes: [
                    baseBox,
                    {
                        ...baseBox,
                        x: 0.5,
                    },
                ],
                deltaX: 0.25,
                deltaY: 0,
            },
            expect: [
                {
                    ...baseBox,
                    x: 0.45,
                },
                {
                    ...baseBox,
                    x: 0.75,
                },
            ],
        },
        {
            it: 'stops every box once one reaches a page edge',
            input: {
                boxes: [
                    baseBox,
                    {
                        ...baseBox,
                        x: 0.5,
                    },
                ],
                deltaX: 0.5,
                deltaY: -0.5,
            },
            expect: [
                {
                    ...baseBox,
                    x: 0.45,
                    y: 0,
                },
                {
                    ...baseBox,
                    x: 0.75,
                    y: 0,
                },
            ],
        },
    ]);
});

describe(getPdfFormFieldBoxBounds.name, () => {
    itCases(getPdfFormFieldBoxBounds, [
        {
            it: 'spans every box',
            input: [
                baseBox,
                {
                    x: 0.5,
                    y: 0.125,
                    width: 0.25,
                    height: 0.5,
                },
            ],
            expect: {
                x: 0.2,
                y: 0.125,
                width: 0.55,
                height: 0.5,
            },
        },
    ]);
});

describe(resizePdfFormFieldBox.name, () => {
    itCases(resizePdfFormFieldBox, [
        {
            it: 'grows from the bottom-right corner',
            input: {
                box: baseBox,
                deltaWidth: 0.25,
                deltaHeight: 0.1,
                minWidth: 0.01,
                minHeight: 0.01,
            },
            expect: {
                ...baseBox,
                width: 0.5,
                height: 0.2,
            },
        },
        {
            it: 'keeps the minimum size and the page edges',
            input: {
                box: baseBox,
                deltaWidth: -1,
                deltaHeight: 5,
                minWidth: 0.05,
                minHeight: 0.05,
            },
            expect: {
                ...baseBox,
                width: 0.05,
                height: 0.7,
            },
        },
    ]);
});

describe(createPdfFormField.name, () => {
    it('centers the default size on the drop point', () => {
        assert.deepEquals(
            omitObjectKeys(
                createPdfFormField({
                    type: PdfFormFieldType.Checkbox,
                    pageNumber: 2,
                    pageSize: {
                        widthPoints: 180,
                        heightPoints: 360,
                    },
                    centerX: 0.5,
                    centerY: 0.5,
                }),
                ['id'],
            ),
            {
                type: PdfFormFieldType.Checkbox,
                pageNumber: 2,
                isRequired: false,
                x: 0.45,
                y: 0.475,
                width: 0.1,
                height: 0.05,
            },
        );
    });
    it('pushes a field dropped near a corner back onto the page', () => {
        const field = createPdfFormField({
            type: PdfFormFieldType.Signature,
            pageNumber: 1,
            pageSize: undefined,
            centerX: 1,
            centerY: 1,
        });

        assert.deepEquals(
            {
                right: field.x + field.width,
                bottom: field.y + field.height,
            },
            {
                right: 1,
                bottom: 1,
            },
        );
    });
});
