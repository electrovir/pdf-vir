import {mergeDefinedProperties, type PartialWithUndefined} from '@augment-vir/common';
import {css, defineElement, defineElementEvent, html, listen} from 'element-vir';
import {ViraButton, ViraColorVariant, ViraInput} from 'vira';
import {pdfFormCssVars} from './pdf-form-css-vars.js';
import {getSignerInitials, normalizeSignerName} from './pdf-form-signature.js';

/**
 * Every piece of text {@link PdfVirSignatureAdopt} renders.
 *
 * @category Internal
 */
export type PdfVirSignatureAdoptI18n = typeof defaultPdfVirSignatureAdoptI18n;

/**
 * The text {@link PdfVirSignatureAdopt} renders when its `i18n` input leaves an entry out.
 *
 * @category Internal
 */
export const defaultPdfVirSignatureAdoptI18n = {
    fullNameLabel: 'Full name',
    /** Shown faintly in the signature preview until a name is typed. */
    previewPlaceholder: 'preview',
    adoptAndSign: 'Adopt and sign',
};

/**
 * Asks the signer to type their name once, previews it as a cursive signature and initials, and
 * emits `signerNameAdopt` with that name when they accept it.
 *
 * @category Internal
 */
export const PdfVirSignatureAdopt = defineElement<
    PartialWithUndefined<{
        i18n: Readonly<PartialWithUndefined<PdfVirSignatureAdoptI18n>>;
    }>
>()({
    tagName: 'pdf-vir-signature-adopt',
    styles: css`
        :host {
            display: flex;
            flex-direction: column;
            gap: 16px;
            max-width: 100%;
        }

        ${ViraInput} {
            max-width: 100%;
            width: 480px;
        }

        .preview {
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-height: 64px;
            padding: 8px 16px;
            color: ${pdfFormCssVars['pdf-vir-page-text-color'].value};
            font-family: ${pdfFormCssVars['pdf-vir-signature-font-family'].value};
            font-size: 40px;
            white-space: nowrap;
            overflow: hidden;

            & .placeholder {
                opacity: 0.3;
            }
        }

        .buttons {
            display: flex;
            justify-content: flex-end;
        }
    `,
    events: {
        signerNameAdopt: defineElementEvent<string>(),
    },
    state() {
        return {
            name: '',
        };
    },
    render({inputs, state, updateState, dispatch, events}) {
        const i18n = mergeDefinedProperties(defaultPdfVirSignatureAdoptI18n, inputs.i18n);
        const signatureText = normalizeSignerName(state.name);

        return html`
            <${ViraInput.assign({
                label: i18n.fullNameLabel,
                value: state.name,
            })}
                ${listen(ViraInput.events.valueChange, (event) => {
                    updateState({
                        name: event.detail,
                    });
                })}
            ></${ViraInput}>
            <div class="preview">
                ${signatureText
                    ? html`
                          <span>${signatureText}</span>
                          <span>${getSignerInitials(state.name)}</span>
                      `
                    : html`
                          <span class="placeholder">${i18n.previewPlaceholder}</span>
                      `}
            </div>
            <div class="buttons">
                <${ViraButton.assign({
                    text: i18n.adoptAndSign,
                    color: ViraColorVariant.Info,
                    isDisabled: !signatureText,
                })}
                    ${listen('click', () => {
                        dispatch(
                            new events.signerNameAdopt({
                                detail: signatureText,
                            }),
                        );
                    })}
                ></${ViraButton}>
            </div>
        `;
    },
});
