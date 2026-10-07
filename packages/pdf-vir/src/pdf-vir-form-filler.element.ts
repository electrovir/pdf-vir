import {
    mergeDefinedProperties,
    omitObjectKeys,
    type PartialWithUndefined,
} from '@augment-vir/common';
import {css, defineElement, defineElementEvent, html, listen, nothing, repeat} from 'element-vir';
import {ViraModal} from 'vira';
import {canPdfFormAssigneeFill} from './pdf-form-assignee.js';
import {pdfFormFieldConfig, type PdfFormField} from './pdf-form-field.js';
import {
    findUnfilledRequiredPdfFormFields,
    isPdfFormFieldFilled,
    type PdfFormValues,
} from './pdf-form-value.js';
import {
    defaultPdfVirFillableFieldI18n,
    PdfVirFillableField,
} from './pdf-vir-fillable-field.element.js';
import {
    defaultPdfVirSignatureAdoptI18n,
    PdfVirSignatureAdopt,
} from './pdf-vir-signature-adopt.element.js';
import {PdfVir, type PdfVirInputs} from './pdf-vir.element.js';

/**
 * Inputs for {@link PdfVirFormFiller}. Everything except the form inputs is passed straight through
 * to the inner {@link PdfVir}.
 *
 * @category Internal
 */
export type PdfVirFormFillerInputs = Omit<PdfVirInputs, 'renderPageOverlay'> & {
    /** The fields to fill out, usually the output of `PdfVirFormEditor`. */
    fields: ReadonlyArray<Readonly<PdfFormField>>;
    values: Readonly<PdfFormValues>;
} & PartialWithUndefined<{
        /**
         * The name the signer has already adopted, which clicking a signature or initials field
         * stamps. While this is `undefined`, clicking one of those fields first asks the signer to
         * adopt a name.
         */
        adoptedSignerName: string;
        /**
         * Stops the built-in prompt from opening so the consumer can show their own on
         * `signerNameRequest`. The filler does not stamp the clicked field once the name arrives:
         * to fill it, add `pdfFormFieldConfig[field.type].getStampText(name)` to `values` for the
         * field from the event.
         */
        useExternalSignaturePrompt: boolean;
        /**
         * The `PdfFormAssignee.id` of who is filling the form. Fields assigned to anyone else are
         * not shown at all. Fields without an assignee can be filled by anyone. Omit to show and
         * let every field be filled.
         */
        assigneeId: string;
        /**
         * Overrides for any of the strings this element renders. Omitted entries keep their
         * {@link defaultPdfVirFormFillerI18n} value.
         */
        i18n: Readonly<PartialWithUndefined<PdfVirFormFillerI18n>>;
    }>;

/**
 * Every piece of text {@link PdfVirFormFiller} renders, so that a consumer can translate or reword
 * it through the `i18n` input.
 *
 * @category Internal
 */
export type PdfVirFormFillerI18n = typeof defaultPdfVirFormFillerI18n;

/**
 * The text {@link PdfVirFormFiller} renders when its `i18n` input leaves an entry out.
 *
 * @category Internal
 */
export const defaultPdfVirFormFillerI18n = {
    adoptSignatureTitle: 'Adopt your signature',
    ...defaultPdfVirSignatureAdoptI18n,
    ...defaultPdfVirFillableFieldI18n,
};

/**
 * Fills out a form built with `PdfVirFormEditor`. Clicking a stamped field clears it. Required
 * fields that are still empty get a dashed red border. `valuesChange` carries the required fields
 * that are still empty after the edit. Before any edit, use `findUnfilledRequiredPdfFormFields` on
 * the same `fields`, `values`, and `assigneeId` to get them.
 *
 * Controlled: every edit only emits `valuesChange` with the full new values, and adopting a name
 * only emits `signerNameAdopt`. Nothing changes on screen until those are passed back in as
 * `values` and `adoptedSignerName`.
 *
 * @category Main
 */
export const PdfVirFormFiller = defineElement<PdfVirFormFillerInputs>()({
    tagName: 'pdf-vir-form-filler',
    styles: css`
        :host {
            display: flex;
            box-sizing: border-box;
            min-height: 0;
        }

        ${PdfVir} {
            flex-grow: 1;
            min-width: 0;
            /* Drop the viewer's default fixed height so it stretches to this host's height. */
            height: auto;
        }
    `,
    events: {
        valuesChange: defineElementEvent<{
            values: PdfFormValues;
            /**
             * The required fields that `assigneeId` can fill and that are still empty in `values`,
             * from `findUnfilledRequiredPdfFormFields`. Empty once the form is complete.
             */
            unfilledRequiredFields: Readonly<PdfFormField>[];
        }>(),
        signerNameAdopt: defineElementEvent<string>(),
        /**
         * Fired with the clicked field when a signature or initials field is clicked while there is
         * no `adoptedSignerName` yet, whether or not `useExternalSignaturePrompt` is set.
         */
        signerNameRequest: defineElementEvent<Readonly<PdfFormField>>(),
    },
    state() {
        return {
            /** The field that gets stamped once the open signature prompt is adopted. */
            adoptingFieldId: undefined as undefined | string,
        };
    },
    render({inputs, state, updateState, dispatch, events}) {
        const i18n = mergeDefinedProperties(defaultPdfVirFormFillerI18n, inputs.i18n);

        function emitValues(values: PdfFormValues) {
            dispatch(
                new events.valuesChange({
                    detail: {
                        values,
                        unfilledRequiredFields: findUnfilledRequiredPdfFormFields({
                            fields: inputs.fields,
                            values,
                            assigneeId: inputs.assigneeId,
                        }),
                    },
                }),
            );
        }

        function stampField(field: Readonly<PdfFormField>, signerName: string) {
            const stampText = pdfFormFieldConfig[field.type].getStampText?.(signerName);
            if (stampText) {
                emitValues({
                    ...inputs.values,
                    [field.id]: stampText,
                });
            }
        }

        function handleStampRequest(field: Readonly<PdfFormField>) {
            if (
                isPdfFormFieldFilled({
                    field,
                    values: inputs.values,
                })
            ) {
                emitValues(omitObjectKeys(inputs.values, [field.id]));
            } else if (inputs.adoptedSignerName) {
                stampField(field, inputs.adoptedSignerName);
            } else {
                dispatch(
                    new events.signerNameRequest({
                        detail: field,
                    }),
                );
                if (!inputs.useExternalSignaturePrompt) {
                    updateState({
                        adoptingFieldId: field.id,
                    });
                }
            }
        }

        const adoptingField = inputs.fields.find((field) => field.id === state.adoptingFieldId);

        return html`
            <${PdfVir.assign({
                ...omitObjectKeys(inputs, [
                    'fields',
                    'values',
                    'adoptedSignerName',
                    'useExternalSignaturePrompt',
                    'assigneeId',
                    'i18n',
                ]),
                renderPageOverlay({pageNumber}) {
                    return html`
                        <div
                            style=${css`
                                position: absolute;
                                inset: 0;
                            `}
                        >
                            ${repeat(
                                inputs.fields.filter((field) => {
                                    return (
                                        field.pageNumber === pageNumber &&
                                        canPdfFormAssigneeFill({
                                            field,
                                            assigneeId: inputs.assigneeId,
                                        })
                                    );
                                }),
                                (field) => field.id,
                                (field) => {
                                    return html`
                                        <${PdfVirFillableField.assign({
                                            field,
                                            values: inputs.values,
                                            i18n,
                                        })}
                                            ${listen(
                                                PdfVirFillableField.events.valueChange,
                                                (event) => {
                                                    emitValues({
                                                        ...inputs.values,
                                                        [field.id]: event.detail,
                                                    });
                                                },
                                            )}
                                            ${listen(
                                                PdfVirFillableField.events.stampRequest,
                                                () => {
                                                    handleStampRequest(field);
                                                },
                                            )}
                                        ></${PdfVirFillableField}>
                                    `;
                                },
                            )}
                        </div>
                    `;
                },
            })}></${PdfVir}>
            <${ViraModal.assign({
                open: !!adoptingField,
                modalTitle: i18n.adoptSignatureTitle,
            })}
                ${listen(ViraModal.events.modalClose, () => {
                    updateState({
                        adoptingFieldId: undefined,
                    });
                })}
            >
                ${adoptingField
                    ? html`
                          <${PdfVirSignatureAdopt.assign({
                              i18n,
                          })}
                              ${listen(PdfVirSignatureAdopt.events.signerNameAdopt, (event) => {
                                  dispatch(
                                      new events.signerNameAdopt({
                                          detail: event.detail,
                                      }),
                                  );
                                  stampField(adoptingField, event.detail);
                                  updateState({
                                      adoptingFieldId: undefined,
                                  });
                              })}
                          ></${PdfVirSignatureAdopt}>
                      `
                    : nothing}
            </${ViraModal}>
        `;
    },
});
