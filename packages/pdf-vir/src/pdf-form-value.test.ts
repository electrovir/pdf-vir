import {assert} from '@augment-vir/assert';
import {describe, it, itCases} from '@augment-vir/test';
import {PdfFormFieldType, type PdfFormField} from './pdf-form-field.js';
import {
    areRequiredPdfFormFieldsFilled,
    findUnfilledRequiredPdfFormFields,
    isPdfFormFieldFilled,
} from './pdf-form-value.js';

function createField(
    overrides: Readonly<Pick<PdfFormField, 'id' | 'type'>> & Partial<PdfFormField>,
) {
    return {
        pageNumber: 1,
        isRequired: true,
        x: 0,
        y: 0,
        width: 0.1,
        height: 0.1,
        ...overrides,
    };
}

const checkboxField = createField({
    id: 'checkbox',
    type: PdfFormFieldType.Checkbox,
});
const textField = createField({
    id: 'text',
    type: PdfFormFieldType.Text,
});
const signatureField = createField({
    id: 'signature',
    type: PdfFormFieldType.Signature,
});
const optionalInitialsField = createField({
    id: 'initials',
    type: PdfFormFieldType.Initials,
    isRequired: false,
});

const allFields = [
    checkboxField,
    textField,
    signatureField,
    optionalInitialsField,
];

describe(isPdfFormFieldFilled.name, () => {
    itCases(isPdfFormFieldFilled, [
        {
            it: 'counts a checked checkbox',
            input: {
                field: checkboxField,
                values: {
                    checkbox: true,
                },
            },
            expect: true,
        },
        {
            it: 'does not count an unchecked checkbox',
            input: {
                field: checkboxField,
                values: {
                    checkbox: false,
                },
            },
            expect: false,
        },
        {
            it: 'does not count whitespace-only text',
            input: {
                field: textField,
                values: {
                    text: '  ',
                },
            },
            expect: false,
        },
        {
            it: 'counts a stamped signature',
            input: {
                field: signatureField,
                values: {
                    signature: 'Jane Doe',
                },
            },
            expect: true,
        },
        {
            it: 'does not count a field with no entry',
            input: {
                field: signatureField,
                values: {},
            },
            expect: false,
        },
    ]);
});

describe(findUnfilledRequiredPdfFormFields.name, () => {
    it('skips filled and optional fields', () => {
        assert.deepEquals(
            findUnfilledRequiredPdfFormFields({
                fields: allFields,
                values: {
                    checkbox: true,
                },
            }),
            [
                textField,
                signatureField,
            ],
        );
    });
    it("only checks the assignee's own and unassigned fields", () => {
        const ownField = createField({
            id: 'own',
            type: PdfFormFieldType.Signature,
            assigneeId: 'signer-1',
        });

        assert.deepEquals(
            findUnfilledRequiredPdfFormFields({
                fields: [
                    ownField,
                    createField({
                        id: 'other',
                        type: PdfFormFieldType.Signature,
                        assigneeId: 'signer-2',
                    }),
                    textField,
                ],
                values: {},
                assigneeId: 'signer-1',
            }),
            [
                ownField,
                textField,
            ],
        );
    });
});

describe(areRequiredPdfFormFieldsFilled.name, () => {
    itCases(areRequiredPdfFormFieldsFilled, [
        {
            it: 'passes when only optional fields are empty',
            input: {
                fields: allFields,
                values: {
                    checkbox: true,
                    text: 'Jane Doe',
                    signature: 'Jane Doe',
                },
            },
            expect: true,
        },
        {
            it: 'fails when a required field is empty',
            input: {
                fields: allFields,
                values: {
                    text: 'Jane Doe',
                    signature: 'Jane Doe',
                },
            },
            expect: false,
        },
    ]);
});
