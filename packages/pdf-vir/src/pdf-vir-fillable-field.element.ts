import {assertWrap, check} from '@augment-vir/assert';
import {
    mapObjectValues,
    mergeDefinedProperties,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {
    css,
    defineElement,
    defineElementEvent,
    html,
    listen,
    nothing,
    type HtmlInterpolation,
} from 'element-vir';
import {noUserSelect, ViraIcon} from 'vira';
import {circleMarkPath, pdfVirIcons} from './icons.js';
import {pdfFormCssVars} from './pdf-form-css-vars.js';
import {pdfFormFieldConfig, PdfFormFieldType, type PdfFormField} from './pdf-form-field.js';
import {
    isPdfFormFieldFilled,
    type PdfFormFieldValue,
    type PdfFormValues,
} from './pdf-form-value.js';

const signatureMeasureFontSizePx = 100;
const signatureMeasureCanvas = {
    current: undefined as undefined | HTMLCanvasElement,
};

/**
 * How many times wider than its font size `text` is when drawn in the signature font. A canvas
 * cannot be handed a `var()`, so the font is resolved against `host`, which picks up any override
 * an ancestor set.
 */
function measureSignatureWidthRatio(text: string, host: Readonly<HTMLElement>) {
    signatureMeasureCanvas.current ??= document.createElement('canvas');
    const context = signatureMeasureCanvas.current.getContext('2d');
    if (!context) {
        return 1;
    }
    const fontFamily =
        globalThis
            .getComputedStyle(host)
            .getPropertyValue(pdfFormCssVars['pdf-vir-signature-font-family'].name.cssText)
            .trim() || pdfFormCssVars['pdf-vir-signature-font-family'].default;
    context.font = `${signatureMeasureFontSizePx}px ${fontFamily}`;
    return context.measureText(text).width / signatureMeasureFontSizePx || 1;
}

function isMissingValue(
    inputs: Readonly<{
        field: Readonly<PdfFormField>;
        values: Readonly<PdfFormValues>;
        isReadOnly?: boolean | undefined;
    }>,
) {
    return !inputs.isReadOnly && inputs.field.isRequired && !isPdfFormFieldFilled(inputs);
}

/**
 * Every piece of text {@link PdfVirFillableField} renders.
 *
 * @category Internal
 */
export type PdfVirFillableFieldI18n = typeof defaultPdfVirFillableFieldI18n;

/**
 * The text {@link PdfVirFillableField} renders when its `i18n` input leaves an entry out.
 *
 * @category Internal
 */
export const defaultPdfVirFillableFieldI18n = {
    /**
     * Each field's tooltip and accessible name, also drawn inside empty signature and initials
     * fields.
     */
    fieldTypeLabels: mapObjectValues(pdfFormFieldConfig, (type, config) => {
        return config.label;
    }),
};

/**
 * One fillable field on a page, as drawn by `PdfVirFormFiller`. Must be rendered directly inside a
 * positioned layer that exactly covers the page, since it positions itself as a percentage of its
 * parent element.
 *
 * Controlled: typing and toggling only emit `valueChange`. Clicking a signature or initials field
 * only emits `stampRequest`, leaving it to the parent to decide what to stamp or clear.
 *
 * @category Internal
 */
export const PdfVirFillableField = defineElement<
    {
        field: Readonly<PdfFormField>;
        values: Readonly<PdfFormValues>;
    } & PartialWithUndefined<{
        /** Shows the field's value without letting it be changed or focused. */
        isReadOnly: boolean;
        i18n: Readonly<PartialWithUndefined<PdfVirFillableFieldI18n>>;
    }>
>()({
    tagName: 'pdf-vir-fillable-field',
    cssVars: {
        'pdf-vir-fillable-field-signature-width-ratio': 1,
    },
    hostClasses: {
        'pdf-vir-fillable-field-missing'({inputs}) {
            return isMissingValue(inputs);
        },
        'pdf-vir-fillable-field-read-only'({inputs}) {
            return !!inputs.isReadOnly;
        },
    },
    styles({hostClasses, cssVars}) {
        return css`
            :host {
                position: absolute;
                box-sizing: border-box;
                display: flex;
                /* Lets the contents size themselves against the field's height. */
                container-type: size;
                border: 1px solid
                    color-mix(
                        in srgb,
                        ${pdfFormCssVars['pdf-vir-field-accent-color'].value} 60%,
                        transparent
                    );
                background-color: color-mix(
                    in srgb,
                    ${pdfFormCssVars['pdf-vir-field-accent-color'].value} 8%,
                    transparent
                );
                color: ${pdfFormCssVars['pdf-vir-field-text-color'].value};
            }

            :host(:hover),
            :host(:focus-within) {
                border-color: ${pdfFormCssVars['pdf-vir-field-accent-color'].value};
                background-color: color-mix(
                    in srgb,
                    ${pdfFormCssVars['pdf-vir-field-accent-color'].value} 16%,
                    transparent
                );
            }

            ${hostClasses['pdf-vir-fillable-field-missing'].selector} {
                border: 1px dashed ${pdfFormCssVars['pdf-vir-red-accent-color'].value};
            }

            ${hostClasses['pdf-vir-fillable-field-read-only'].selector} {
                border-color: ${pdfFormCssVars['pdf-vir-page-border-color'].value};
                background-color: transparent;
                color: ${pdfFormCssVars['pdf-vir-page-border-color'].value};
            }

            .required-marker {
                position: absolute;
                top: -0.6em;
                right: -0.4em;
                color: ${pdfFormCssVars['pdf-vir-red-accent-color'].value};
                font-weight: bold;
                font-size: 14px;
                pointer-events: none;
            }

            .fill-button {
                display: flex;
                justify-content: center;
                align-items: center;
                gap: 4px;
                width: 100%;
                height: 100%;
                padding: 0;
                border: none;
                background: none;
                color: inherit;
                font: inherit;
                font-size: min(14px, 60cqh);
                cursor: pointer;
                overflow: hidden;
                ${noUserSelect}

                & ${ViraIcon} {
                    height: min(24px, 80cqh);
                    aspect-ratio: 1;
                }
            }

            .checkbox {
                display: flex;
                box-sizing: border-box;
                /* Stays square and centered no matter how the field itself was drawn. */
                height: min(80cqh, 80cqw);
                aspect-ratio: 1;
                border: 1px solid ${pdfFormCssVars['pdf-vir-field-accent-color'].value};
                border-radius: 2px;
                background-color: ${pdfFormCssVars['pdf-vir-page-background-color'].value};

                & ${ViraIcon} {
                    height: 100%;
                    width: 100%;
                }
            }

            .circle-mark {
                /*
                 * Positioned against the host rather than the button so the loop can reach past the
                 * field's edges without the button's overflow clipping it.
                 */
                position: absolute;
                top: -15%;
                left: -8%;
                width: 116%;
                height: 130%;
                pointer-events: none;
                fill: none;
                stroke: ${pdfFormCssVars['pdf-vir-page-text-color'].value};
                stroke-width: 2px;
                stroke-linecap: round;
            }

            .signature-text {
                color: ${pdfFormCssVars['pdf-vir-page-text-color'].value};
                font-family: ${pdfFormCssVars['pdf-vir-signature-font-family'].value};
                /* Shrinks long text to fit the field's width instead of clipping it. */
                font-size: min(
                    75cqh,
                    calc(90cqw / ${cssVars['pdf-vir-fillable-field-signature-width-ratio'].value})
                );
                white-space: nowrap;
            }

            .text-input {
                width: 100%;
                height: 100%;
                box-sizing: border-box;
                padding: 0 2px;
                border: none;
                background: none;
                color: ${pdfFormCssVars['pdf-vir-page-text-color'].value};
                font-family: sans-serif;
                font-size: 70cqh;
                outline: none;

                &[type='date'] {
                    /* Shrinks the date and its picker icon to fit the field's width. */
                    font-size: min(70cqh, 13cqw);
                }

                /* Safari fills the text of an empty date input with today's date. */
                &.empty:not(:focus)::-webkit-datetime-edit {
                    opacity: 0;
                }
            }
        `;
    },
    events: {
        valueChange: defineElementEvent<PdfFormFieldValue>(),
        stampRequest: defineElementEvent<void>(),
    },
    render({inputs, host, dispatch, events, cssVars}) {
        const i18n = mergeDefinedProperties(defaultPdfVirFillableFieldI18n, inputs.i18n);
        const value = inputs.values[inputs.field.id];

        function emitValue(newValue: PdfFormFieldValue) {
            dispatch(
                new events.valueChange({
                    detail: newValue,
                }),
            );
        }

        function renderSignatureField() {
            return html`
                <button
                    class="fill-button"
                    title=${i18n.fieldTypeLabels[inputs.field.type]}
                    ${listen('click', () => {
                        dispatch(
                            new events.stampRequest({
                                detail: undefined,
                            }),
                        );
                    })}
                >
                    ${check.isString(value) && value
                        ? html`
                              <span
                                  class="signature-text"
                                  style=${css`
                                      ${cssVars['pdf-vir-fillable-field-signature-width-ratio']
                                          .name}: ${measureSignatureWidthRatio(value, host)};
                                  `}
                              >
                                  ${value}
                              </span>
                          `
                        : html`
                              <${ViraIcon.assign({
                                  icon: pdfFormFieldConfig[inputs.field.type].icon,
                                  fitContainer: true,
                              })}></${ViraIcon}>
                              ${i18n.fieldTypeLabels[inputs.field.type]}
                          `}
                </button>
            `;
        }

        function renderTextInput(inputType: string) {
            return html`
                <input
                    class="text-input ${check.isString(value) && value ? '' : 'empty'}"
                    type=${inputType}
                    aria-label=${i18n.fieldTypeLabels[inputs.field.type]}
                    .value=${check.isString(value) ? value : ''}
                    ${listen('input', (event) => {
                        emitValue(
                            assertWrap.instanceOf(event.currentTarget, HTMLInputElement).value,
                        );
                    })}
                />
            `;
        }

        const fieldTemplates: Record<PdfFormFieldType, () => HtmlInterpolation> = {
            [PdfFormFieldType.Checkbox]() {
                return html`
                    <button
                        class="fill-button"
                        role="checkbox"
                        aria-checked=${value === true}
                        title=${i18n.fieldTypeLabels[inputs.field.type]}
                        ${listen('click', () => {
                            emitValue(value !== true);
                        })}
                    >
                        <span class="checkbox">
                            ${value === true
                                ? html`
                                      <${ViraIcon.assign({
                                          icon: pdfVirIcons.check,
                                          fitContainer: true,
                                      })}></${ViraIcon}>
                                  `
                                : nothing}
                        </span>
                    </button>
                `;
            },
            [PdfFormFieldType.CircleOne]() {
                return html`
                    <button
                        class="fill-button"
                        role="checkbox"
                        aria-checked=${value === true}
                        title=${i18n.fieldTypeLabels[inputs.field.type]}
                        ${listen('click', () => {
                            emitValue(value !== true);
                        })}
                    >
                        ${value === true
                            ? html`
                                  <svg
                                      class="circle-mark"
                                      viewBox="0 0 100 100"
                                      preserveAspectRatio="none"
                                  >
                                      <path
                                          vector-effect="non-scaling-stroke"
                                          d=${circleMarkPath}
                                      />
                                  </svg>
                              `
                            : nothing}
                    </button>
                `;
            },
            [PdfFormFieldType.Text]() {
                return renderTextInput('text');
            },
            [PdfFormFieldType.Date]() {
                return renderTextInput('date');
            },
            [PdfFormFieldType.Signature]: renderSignatureField,
            [PdfFormFieldType.Initials]: renderSignatureField,
        };

        host.style.left = `${inputs.field.x * 100}%`;
        host.style.top = `${inputs.field.y * 100}%`;
        host.style.width = `${inputs.field.width * 100}%`;
        host.style.height = `${inputs.field.height * 100}%`;
        host.inert = !!inputs.isReadOnly;

        return html`
            ${fieldTemplates[inputs.field.type]()}
            ${isMissingValue(inputs)
                ? html`
                      <span class="required-marker">*</span>
                  `
                : nothing}
        `;
    },
});
