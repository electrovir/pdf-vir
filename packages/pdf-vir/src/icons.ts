import {arrayToObject} from '@augment-vir/common';
import {html, type CSSResult} from 'element-vir';
import {
    createColoredIcon,
    createSizedIcon,
    defineIcon,
    LoaderAnimated24Icon,
    lucideIcons,
    viraIconCssVars,
    viraTheme,
} from 'vira';
import {getPdfFormAssigneeColorValues, pdfFormAssigneeColors} from './pdf-form-assignee.js';
import type {PdfFormFieldType} from './pdf-form-field.js';

/**
 * The hand-drawn loop that marks a circled {@link PdfFormFieldType.CircleOne} field, in a 100 by 100
 * `viewBox`. Draw it with `preserveAspectRatio="none"` and `vector-effect="non-scaling-stroke"` so
 * it stretches to any field shape without warping the pen width.
 *
 * @category Internal
 */
export const circleMarkPath =
    'M 66 14 C 30 8, 5 22, 5 52 C 5 80, 36 95, 62 94 C 88 92, 96 70, 95 46 C 94 20, 72 4, 34 5';

function createAssigneeDotIcon(color: CSSResult) {
    return createSizedIcon(
        createColoredIcon(lucideIcons.CircleSmall, {
            'vira-icon-fill-color': color,
            'vira-icon-stroke-color': color,
        }),
        16,
    );
}

/**
 * Every icon pdf-vir renders. Lucide icons carry no size of their own, so the ones placed inside a
 * `ViraButton` are sized here or the button would draw them at its own default.
 *
 * @category Internal
 */
export const pdfVirIcons = {
    add: createSizedIcon(lucideIcons.Plus, 16),
    assigneeDots: arrayToObject(
        pdfFormAssigneeColors,
        (color) => {
            return {
                key: color,
                value: createAssigneeDotIcon(getPdfFormAssigneeColorValues(color).uiAccent),
            };
        },
        {
            useRequired: true,
        },
    ),
    calendar: lucideIcons.Calendar,
    caseUpper: lucideIcons.CaseUpper,
    check: lucideIcons.Check,
    circleMark: defineIcon({
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
    }),
    edit: createSizedIcon(lucideIcons.Pencil, 16),
    everyoneDot: createAssigneeDotIcon(
        viraTheme.colors['vira-grey-foreground-placeholder'].foreground.value,
    ),
    loader: LoaderAnimated24Icon,
    preview: createSizedIcon(lucideIcons.Eye, 16),
    reset: createSizedIcon(lucideIcons.RotateCcw, 16),
    resetZoom: lucideIcons.RotateCcw,
    save: createSizedIcon(lucideIcons.Check, 16),
    signature: lucideIcons.Signature,
    squareCheck: lucideIcons.SquareCheck,
    textCursorInput: lucideIcons.TextCursorInput,
    trash: createSizedIcon(lucideIcons.Trash, 16),
    zoomIn: lucideIcons.ZoomIn,
    zoomOut: lucideIcons.ZoomOut,
};
