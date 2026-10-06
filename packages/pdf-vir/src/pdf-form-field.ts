import {check} from '@augment-vir/assert';
import {clamp, randomString} from '@augment-vir/common';
import {html} from 'element-vir';
import {defineShape, enumShape} from 'object-shape-tester';
import {defineIcon, lucideIcons, viraIconCssVars, type ViraIconSvg} from 'vira';
import {getPageAspectRatio, getPageIntrinsicWidth, type PagePointSize} from './page-layout.js';
import {getSignerInitials, normalizeSignerName} from './pdf-form-signature.js';
import type {PdfFormFieldValue} from './pdf-form-value.js';

/**
 * Every kind of field that `PdfVirFormEditor` can place on a PDF.
 *
 * @category Internal
 */
export enum PdfFormFieldType {
    Signature = 'signature',
    Initials = 'initials',
    Text = 'text',
    Date = 'date',
    Checkbox = 'checkbox',
    /** Clicked to circle whatever on the page it covers, such as one choice out of several. */
    CircleOne = 'circle-one',
}

/**
 * Shape for {@link PdfFormFieldBox}.
 *
 * @category Internal
 */
export const pdfFormFieldBoxShape = defineShape({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
});

/**
 * A field's position and size as fractions (0 to 1) of its page's width and height, measured from
 * the page's top-left corner. Fractions keep a field in place at any zoom level or render size. To
 * draw onto the PDF itself, multiply by the page size in points and flip the y axis: PDF
 * coordinates start at the bottom-left.
 *
 * @category Internal
 */
export type PdfFormFieldBox = typeof pdfFormFieldBoxShape.runtimeType;

/**
 * Validates a {@link PdfFormField}, such as one loaded from storage before it is passed back into
 * `PdfVirFormEditor`'s `fields` input.
 *
 * @category Internal
 */
export const pdfFormFieldShape = defineShape({
    ...pdfFormFieldBoxShape.default,
    id: '',
    type: enumShape(PdfFormFieldType),
    /** Starts at 1. */
    pageNumber: 0,
    isRequired: false,
});

/**
 * One field placed on a PDF by `PdfVirFormEditor`.
 *
 * @category Internal
 */
export type PdfFormField = typeof pdfFormFieldShape.runtimeType;

function isNonBlankString(this: void, value: PdfFormFieldValue | undefined) {
    return check.isString(value) && !!value.trim();
}

/**
 * The hand-drawn loop that marks a circled {@link PdfFormFieldType.CircleOne} field, in a 100 by 100
 * `viewBox`. Draw it with `preserveAspectRatio="none"` and `vector-effect="non-scaling-stroke"` so
 * it stretches to any field shape without warping the pen width.
 *
 * @category Internal
 */
export const circleMarkPath =
    'M 66 14 C 30 8, 5 22, 5 52 C 5 80, 36 95, 62 94 C 88 92, 96 70, 95 46 C 94 20, 72 4, 34 5';

const circleMarkIcon = defineIcon({
    name: 'CircleMark',
    /* The `viewBox` is taller than the path so the loop draws as a wide oval, like a circled word. */
    svgTemplate: html`
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="-2 -40 104 180"
            preserveAspectRatio="none"
            fill="none"
            stroke=${viraIconCssVars['vira-icon-stroke-color'].value}
            stroke-width=${viraIconCssVars['vira-icon-stroke-width'].value}
            stroke-linecap="round"
        >
            <path vector-effect="non-scaling-stroke" d=${circleMarkPath}></path>
        </svg>
    `,
});

/**
 * Everything that varies between {@link PdfFormFieldType}s: how a field is drawn, how big it starts
 * out, when it counts as filled, and what clicking it stamps.
 *
 * @category Internal
 */
export const pdfFormFieldConfig: Readonly<
    Record<
        PdfFormFieldType,
        {
            label: string;
            icon: ViraIconSvg;
            /** Size of a newly placed field. */
            defaultSize: {
                widthPoints: number;
                heightPoints: number;
            };
            /** Whether a newly placed field of this type is required. */
            requiredByDefault: boolean;
            /** Checks whether the field has been filled or not. */
            isFilled: (value: PdfFormFieldValue | undefined) => boolean;
            /**
             * Derives the text that clicking the field stamps into it from the signer's adopted
             * name, or `undefined` for field types that are filled some other way.
             */
            getStampText: ((signerName: string) => string) | undefined;
        }
    >
> = {
    [PdfFormFieldType.Checkbox]: {
        label: 'Checkbox',
        icon: lucideIcons.SquareCheck,
        defaultSize: {
            widthPoints: 18,
            heightPoints: 18,
        },
        requiredByDefault: false,
        isFilled(value) {
            return value === true;
        },
        getStampText: undefined,
    },
    [PdfFormFieldType.Text]: {
        label: 'Text',
        icon: lucideIcons.TextCursorInput,
        defaultSize: {
            widthPoints: 150,
            heightPoints: 22,
        },
        requiredByDefault: true,
        isFilled: isNonBlankString,
        getStampText: undefined,
    },
    [PdfFormFieldType.Date]: {
        label: 'Date',
        icon: lucideIcons.Calendar,
        defaultSize: {
            widthPoints: 90,
            heightPoints: 22,
        },
        requiredByDefault: true,
        isFilled: isNonBlankString,
        getStampText: undefined,
    },
    [PdfFormFieldType.CircleOne]: {
        label: 'Circle One',
        icon: circleMarkIcon,
        defaultSize: {
            widthPoints: 50,
            heightPoints: 24,
        },
        requiredByDefault: false,
        isFilled(value) {
            return value === true;
        },
        getStampText: undefined,
    },
    [PdfFormFieldType.Signature]: {
        label: 'Signature',
        icon: lucideIcons.Signature,
        defaultSize: {
            widthPoints: 160,
            heightPoints: 40,
        },
        requiredByDefault: true,
        isFilled: isNonBlankString,
        getStampText: normalizeSignerName,
    },
    [PdfFormFieldType.Initials]: {
        label: 'Initials',
        icon: lucideIcons.CaseUpper,
        defaultSize: {
            widthPoints: 60,
            heightPoints: 30,
        },
        requiredByDefault: true,
        isFilled: isNonBlankString,
        getStampText: getSignerInitials,
    },
};

/**
 * Shifts a box by the given fractions of the page, stopping at the page edges instead of letting
 * any part of the box leave the page.
 *
 * @category Internal
 */
export function movePdfFormFieldBox({
    box,
    deltaX,
    deltaY,
}: Readonly<{
    box: Readonly<PdfFormFieldBox>;
    deltaX: number;
    deltaY: number;
}>) {
    return {
        ...box,
        x: clamp(box.x + deltaX, {
            min: 0,
            max: 1 - box.width,
        }),
        y: clamp(box.y + deltaY, {
            min: 0,
            max: 1 - box.height,
        }),
    };
}

/**
 * Grows or shrinks a box from its bottom-right corner, keeping its top-left corner in place. The
 * box never extends past the page edges, even if that makes it smaller than the given minimum.
 *
 * @category Internal
 */
export function resizePdfFormFieldBox({
    box,
    deltaWidth,
    deltaHeight,
    minWidth,
    minHeight,
}: Readonly<{
    box: Readonly<PdfFormFieldBox>;
    deltaWidth: number;
    deltaHeight: number;
    minWidth: number;
    minHeight: number;
}>) {
    return {
        ...box,
        width: clamp(box.width + deltaWidth, {
            min: minWidth,
            max: 1 - box.x,
        }),
        height: clamp(box.height + deltaHeight, {
            min: minHeight,
            max: 1 - box.y,
        }),
    };
}

/**
 * Creates a new field of the type's default size, centered on the given point (fractions of the
 * page) and then pushed back inside the page if it would hang off an edge.
 *
 * @category Internal
 */
export function createPdfFormField({
    type,
    pageNumber,
    pageSize,
    centerX,
    centerY,
}: Readonly<{
    type: PdfFormFieldType;
    pageNumber: number;
    /** `undefined` falls back to US letter. */
    pageSize: Readonly<PagePointSize> | undefined;
    centerX: number;
    centerY: number;
}>) {
    const pageWidthPoints = getPageIntrinsicWidth(pageSize);
    const pageHeightPoints = pageWidthPoints / getPageAspectRatio(pageSize);
    const width = Math.min(pdfFormFieldConfig[type].defaultSize.widthPoints / pageWidthPoints, 1);
    const height = Math.min(
        pdfFormFieldConfig[type].defaultSize.heightPoints / pageHeightPoints,
        1,
    );

    return {
        id: randomString(),
        type,
        pageNumber,
        isRequired: pdfFormFieldConfig[type].requiredByDefault,
        ...movePdfFormFieldBox({
            box: {
                x: centerX - width / 2,
                y: centerY - height / 2,
                width,
                height,
            },
            deltaX: 0,
            deltaY: 0,
        }),
    };
}
