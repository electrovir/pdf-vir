import {type PartialWithUndefined, type Values} from '@augment-vir/common';
import {defineShape, recordShape, unionShape} from 'object-shape-tester';
import {canPdfFormAssigneeFill} from './pdf-form-assignee.js';
import {pdfFormFieldConfig, type PdfFormField} from './pdf-form-field.js';

/**
 * Validates {@link PdfFormValues}, such as values loaded from storage before they are passed back
 * into `PdfVirFormFiller`'s `values` input.
 *
 * @category Internal
 */
export const pdfFormValuesShape = defineShape(
    recordShape({
        keys: '',
        values: unionShape(false, ''),
    }),
);

/**
 * What a user has filled into each field of a PDF form, keyed by `PdfFormField.id`. Checkboxes hold
 * a boolean. Text fields hold their text, and signature and initials fields hold the text stamped
 * from the signer's adopted name. A field that hasn't been filled has no entry.
 *
 * @category Internal
 */
export type PdfFormValues = typeof pdfFormValuesShape.runtimeType;

/**
 * The value of a single field in {@link PdfFormValues}.
 *
 * @category Internal
 */
export type PdfFormFieldValue = Values<PdfFormValues>;

/**
 * Checks if a field has a value. A checkbox only counts as filled when it is checked, and text that
 * is only whitespace does not count.
 *
 * @category Internal
 */
export function isPdfFormFieldFilled({
    field,
    values,
}: Readonly<{
    field: Readonly<Pick<PdfFormField, 'id' | 'type'>>;
    values: Readonly<PdfFormValues>;
}>) {
    return pdfFormFieldConfig[field.type].isFilled(values[field.id]);
}

/**
 * Finds every required field that {@link isPdfFormFieldFilled} says is not filled, in the order the
 * fields were given. With an `assigneeId`, only the fields that assignee can fill are checked:
 * their own and those assigned to no one.
 *
 * @category Internal
 */
export function findUnfilledRequiredPdfFormFields<const Field extends Readonly<PdfFormField>>({
    fields,
    values,
    assigneeId,
}: Readonly<
    {
        fields: ReadonlyArray<Field>;
        values: Readonly<PdfFormValues>;
    } & PartialWithUndefined<{
        assigneeId: string;
    }>
>) {
    return fields.filter((field) => {
        return (
            field.isRequired &&
            canPdfFormAssigneeFill({
                field,
                assigneeId,
            }) &&
            !isPdfFormFieldFilled({
                field,
                values,
            })
        );
    });
}

/**
 * Checks if every required field is filled. Optional fields are ignored. With an `assigneeId`, only
 * the fields that assignee can fill are checked.
 *
 * @category Internal
 */
export function areRequiredPdfFormFieldsFilled(
    params: Readonly<
        {
            fields: ReadonlyArray<Readonly<PdfFormField>>;
            values: Readonly<PdfFormValues>;
        } & PartialWithUndefined<{
            assigneeId: string;
        }>
    >,
) {
    return !findUnfilledRequiredPdfFormFields(params).length;
}
