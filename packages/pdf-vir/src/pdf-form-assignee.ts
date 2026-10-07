import {assertWrap} from '@augment-vir/assert';
import {arrayToObject, pickObjectKeys, type ArrayElement} from '@augment-vir/common';
import {unsafeCSS} from 'element-vir';
import {defineShape, enumShape, nullableShape} from 'object-shape-tester';
import {viraTheme, ViraThemeColorName} from 'vira';
import {type PdfFormField} from './pdf-form-field.js';

/**
 * The Vira colors a {@link PdfFormAssignee} can be drawn in, in the order they are picked for
 * assignees without their own `color`. Grey is left out because it marks fields assigned to no
 * one.
 *
 * @category Internal
 */
export const pdfFormAssigneeColors = [
    ViraThemeColorName.blue,
    ViraThemeColorName.purple,
    ViraThemeColorName.green,
    ViraThemeColorName.pink,
    ViraThemeColorName.teal,
    ViraThemeColorName.yellow,
] as const;

/**
 * One of {@link pdfFormAssigneeColors}.
 *
 * @category Internal
 */
export type PdfFormAssigneeColor = ArrayElement<typeof pdfFormAssigneeColors>;

/**
 * Shape for {@link PdfFormAssignee}.
 *
 * @category Internal
 */
export const pdfFormAssigneeShape = defineShape({
    id: '',
    label: '',
    /** When omitted, the color is picked by the assignee's position in the list. */
    color: nullableShape(enumShape(pickObjectKeys(ViraThemeColorName, pdfFormAssigneeColors))),
});

/**
 * Someone a form field can be assigned to, such as one signer of a document or a signer role like
 * "Patient". Pass a list of these to `PdfVirFormEditor`'s `assignees` input.
 *
 * @category Internal
 */
export type PdfFormAssignee = typeof pdfFormAssigneeShape.runtimeType;

/**
 * The colors for one Vira hue. Fields on the PDF page use the light mode values because the page
 * stays light in dark mode. Everything outside the page uses the theme CSS vars.
 */
function defineAssigneeColor(hue: ViraThemeColorName) {
    return {
        accent: unsafeCSS(viraTheme.colors[`vira-${hue}-foreground-header`].foreground.default),
        text: unsafeCSS(viraTheme.colors[`vira-${hue}-foreground-body`].foreground.default),
        uiAccent: viraTheme.colors[`vira-${hue}-foreground-header`].foreground.value,
    };
}

const assigneeColors = arrayToObject(
    pdfFormAssigneeColors,
    (color) => {
        return {
            key: color,
            value: defineAssigneeColor(color),
        };
    },
    {
        useRequired: true,
    },
);

const unassignedColor = defineAssigneeColor(ViraThemeColorName.grey);

/**
 * The {@link PdfFormAssigneeColor} of each assignee: its own `color`, or else one picked by its
 * position in `assignees`. Picked colors repeat once there are more assignees than colors.
 *
 * @category Internal
 */
export function resolvePdfFormAssigneeColors(assignees: ReadonlyArray<Readonly<PdfFormAssignee>>) {
    return assignees.map((assignee, index) => {
        return (
            assignee.color ||
            assertWrap.isDefined(pdfFormAssigneeColors[index % pdfFormAssigneeColors.length])
        );
    });
}

/**
 * The CSS colors that fields assigned to `assigneeId` are drawn in, from
 * {@link resolvePdfFormAssigneeColors}. An `assigneeId` that is missing from `assignees` gets grey.
 *
 * @category Internal
 */
export function getPdfFormAssigneeColor({
    assignees,
    assigneeId,
}: Readonly<{
    assignees: ReadonlyArray<Readonly<PdfFormAssignee>>;
    assigneeId: PdfFormField['assigneeId'];
}>) {
    const color =
        resolvePdfFormAssigneeColors(assignees)[
            assignees.findIndex((assignee) => assignee.id === assigneeId)
        ];

    return color ? getPdfFormAssigneeColorValues(color) : unassignedColor;
}

/**
 * The CSS colors for a single {@link PdfFormAssigneeColor}.
 *
 * @category Internal
 */
export function getPdfFormAssigneeColorValues(color: PdfFormAssigneeColor) {
    return assigneeColors[color];
}

/**
 * The color for a new assignee added to the end of `assignees`: the first color no existing
 * assignee is drawn in, or the one its position would pick once every color is taken.
 *
 * @category Internal
 */
export function pickNewPdfFormAssigneeColor(assignees: ReadonlyArray<Readonly<PdfFormAssignee>>) {
    const usedColors = resolvePdfFormAssigneeColors(assignees);

    return (
        pdfFormAssigneeColors.find((color) => !usedColors.includes(color)) ||
        assertWrap.isDefined(pdfFormAssigneeColors[assignees.length % pdfFormAssigneeColors.length])
    );
}

/**
 * Checks if `assigneeId` may fill `field`: the field is assigned to them or to no one. An undefined
 * `assigneeId` may fill every field.
 *
 * @category Internal
 */
export function canPdfFormAssigneeFill({
    field,
    assigneeId,
}: Readonly<{
    field: Readonly<Pick<PdfFormField, 'assigneeId'>>;
    assigneeId: string | undefined;
}>) {
    return assigneeId == undefined || !field.assigneeId || field.assigneeId === assigneeId;
}
