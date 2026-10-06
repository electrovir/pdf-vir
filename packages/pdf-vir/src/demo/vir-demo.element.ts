/// <reference types="vite/client" />

import {assert, assertWrap, check} from '@augment-vir/assert';
import {
    getObjectTypedValues,
    omitObjectKeys,
    removePrefix,
    removeSuffix,
} from '@augment-vir/common';
import {css, defineElement, html, listen, nothing, type HtmlInterpolation} from 'element-vir';
import {SpaRouter} from 'spa-router-vir';
import {
    lucideIcons,
    ViraButton,
    ViraColorVariant,
    ViraDropdown,
    ViraEmphasis,
    type ViraDropdownOption,
} from 'vira';
import {pdfFormFieldConfig, type PdfFormField} from '../pdf-form-field.js';
import {findUnfilledRequiredPdfFormFields, type PdfFormValues} from '../pdf-form-value.js';
import {PdfVirFormEditor} from '../pdf-vir-form-editor.element.js';
import {PdfVirFormFiller} from '../pdf-vir-form-filler.element.js';
import {PdfVir} from '../pdf-vir.element.js';
import {createDemoLocalDbClient, type DemoLocalDbClient} from './local-db.client.js';

enum DemoMode {
    Viewer = 'viewer',
    FormEditor = 'form-editor',
    FormFiller = 'form-filler',
}

const demoModeLabels: Record<DemoMode, string> = {
    [DemoMode.Viewer]: 'View',
    [DemoMode.FormEditor]: 'Edit',
    [DemoMode.FormFiller]: 'Fill',
};

const demoRouter = new SpaRouter<[DemoMode], undefined, undefined>({
    /**
     * Vite's base is `/` while developing and `/<repo-name>/` for the GitHub Pages build, but the
     * router wants the bare segment with no slashes.
     */
    basePath: removeSuffix({
        value: removePrefix({
            value: import.meta.env.BASE_URL,
            prefix: '/',
        }),
        suffix: '/',
    }),
    sanitizeRoute(rawRoute) {
        return {
            paths: [
                check.isEnumValue(rawRoute.paths[0], DemoMode)
                    ? rawRoute.paths[0]
                    : DemoMode.Viewer,
            ],
            search: undefined,
            hash: undefined,
        };
    },
});

/**
 * `lucideIcons.RotateCcw` carries no size of its own, so `ViraButton` would draw it at its own
 * default.
 */
const resetIcon = {
    ...lucideIcons.RotateCcw,
    size: 16,
};

const committedDemoPath = '/demo.pdf';

const extraPdfModules = import.meta.glob('../../www-static/extra-pdfs/*.pdf');

const extraPdfOptions: ReadonlyArray<ViraDropdownOption> = Object.keys(extraPdfModules)
    .map((modulePath): ViraDropdownOption => {
        const fileName = modulePath.split('/').pop() ?? modulePath;
        return {
            value: `/extra-pdfs/${fileName}`,
            label: fileName,
        };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

const pdfOptions: ReadonlyArray<ViraDropdownOption> = [
    {
        value: committedDemoPath,
        label: 'demo.pdf',
    },
    ...extraPdfOptions,
];

export const VirDemo = defineElement()({
    tagName: 'vir-demo',
    styles: css`
        :host {
            display: flex;
            flex-direction: column;
            align-items: center;
            height: 100%;
            width: 100%;
            padding: 16px;
            gap: 16px;
            box-sizing: border-box;
            font-family: sans-serif;
        }

        .controls {
            display: flex;
            /* The dropdowns carry a label above them, so bottom alignment lines everything up. */
            align-items: flex-end;
            gap: 16px;
        }

        ${PdfVirFormEditor}, ${PdfVirFormFiller} {
            flex-grow: 1;
            width: 100%;
            max-width: 1000px;
        }

        .form-status {
            display: flex;
            align-items: center;
            gap: 16px;

            & p {
                margin: 0;
            }
        }

        ${PdfVir} {
            flex-grow: 1;
            box-sizing: border-box;
            overscroll-behavior: contain;
        }
    `,
    state() {
        return {
            selectedPdf: committedDemoPath,
            mode: demoRouter.readCurrentRoute().paths[0],
            formFieldsByPdf: {} as Partial<Record<string, PdfFormField[]>>,
            formValuesByPdf: {} as Partial<Record<string, PdfFormValues>>,
            adoptedSignerName: '',
            localDbClient: {
                current: undefined as undefined | DemoLocalDbClient,
            },
            routeListener: {
                current: undefined as undefined | (() => void),
            },
        };
    },
    init({state, updateState}) {
        state.routeListener.current = demoRouter.listen(true, (route) => {
            updateState({
                mode: route.paths[0],
            });
        });
        void createDemoLocalDbClient().then((localDbClient) => {
            state.localDbClient.current = localDbClient;
            updateState({
                formFieldsByPdf: localDbClient.value.formFields ?? {},
                formValuesByPdf: localDbClient.value.formValues ?? {},
                adoptedSignerName: localDbClient.value.adoptedSignerName || '',
            });
        });
    },
    render({state, updateState}) {
        const modeTemplates: Record<DemoMode, () => HtmlInterpolation> = {
            [DemoMode.Viewer]: renderViewer,
            [DemoMode.FormEditor]() {
                return html`
                    <${PdfVirFormEditor.assign({
                        pdfSource: state.selectedPdf,
                        pdfiumWasmUrl: '/pdfium.wasm',
                        enableZoomControls: true,
                        fields: state.formFieldsByPdf[state.selectedPdf] ?? [],
                    })}
                        ${listen(PdfVirFormEditor.events.fieldsChange, (event) => {
                            const formFieldsByPdf = {
                                ...state.formFieldsByPdf,
                                [state.selectedPdf]: event.detail,
                            };
                            updateState({
                                formFieldsByPdf,
                            });
                            void state.localDbClient.current?.set.formFields(formFieldsByPdf);
                        })}
                    ></${PdfVirFormEditor}>
                `;
            },
            [DemoMode.FormFiller]() {
                const fields = state.formFieldsByPdf[state.selectedPdf] ?? [];
                const values = state.formValuesByPdf[state.selectedPdf] ?? {};
                const unfilledCount = findUnfilledRequiredPdfFormFields({
                    fields,
                    values,
                }).length;

                function saveValues(newValues: PdfFormValues) {
                    const formValuesByPdf = {
                        ...state.formValuesByPdf,
                        [state.selectedPdf]: newValues,
                    };
                    updateState({
                        formValuesByPdf,
                    });
                    void state.localDbClient.current?.set.formValues(formValuesByPdf);
                }

                return html`
                    <div class="form-status">
                        <p>
                            ${fields.length
                                ? unfilledCount
                                    ? `${unfilledCount} required field(s) left to fill.`
                                    : 'All required fields are filled.'
                                : 'Add fields in the form editor first.'}
                        </p>
                        ${state.adoptedSignerName
                            ? html`
                                  <${ViraButton.assign({
                                      text: 'Change signature',
                                  })}
                                      ${listen('click', () => {
                                          updateState({
                                              adoptedSignerName: '',
                                          });
                                          void state.localDbClient.current?.delete.adoptedSignerName();
                                          /**
                                           * Stamps of the old signature would no longer match the
                                           * new one.
                                           */
                                          saveValues(
                                              omitObjectKeys(
                                                  values,
                                                  fields
                                                      .filter((field) => {
                                                          return !!pdfFormFieldConfig[field.type]
                                                              .getStampText;
                                                      })
                                                      .map((field) => field.id),
                                              ),
                                          );
                                      })}
                                  ></${ViraButton}>
                              `
                            : nothing}
                    </div>
                    <${PdfVirFormFiller.assign({
                        pdfSource: state.selectedPdf,
                        pdfiumWasmUrl: '/pdfium.wasm',
                        enableZoomControls: true,
                        fields,
                        values,
                        adoptedSignerName: state.adoptedSignerName,
                    })}
                        ${listen(PdfVirFormFiller.events.valuesChange, (event) => {
                            saveValues(event.detail);
                        })}
                        ${listen(PdfVirFormFiller.events.signerNameAdopt, (event) => {
                            updateState({
                                adoptedSignerName: event.detail,
                            });
                            void state.localDbClient.current?.set.adoptedSignerName(event.detail);
                        })}
                    ></${PdfVirFormFiller}>
                `;
            },
        };

        function renderViewer() {
            return html`
                <${PdfVir.assign({
                    pdfSource: state.selectedPdf,
                    pdfiumWasmUrl: '/pdfium.wasm',
                    enableZoomControls: true,
                    stylePassthrough: {
                        'canvas-wrapper': css`
                            display: flex;
                        `,
                        canvas: css`
                            flex-grow: 1;
                        `,
                    },
                })}
                    ${listen(PdfVir.events.canvasLoad, (event) => {
                        const {context, pageNumber} = event.detail;

                        if (state.selectedPdf === committedDemoPath && pageNumber === 1) {
                            context.beginPath();
                            /** Render a box. */
                            context.rect(90, 125, 210, 25);
                            context.lineWidth = 3;
                            context.strokeStyle = 'red';
                            context.stroke();
                        }
                    })}
                ></${PdfVir}>
            `;
        }

        return html`
            <div class="controls">
                <${ViraDropdown.assign({
                    label: 'PDF',
                    options: pdfOptions,
                    selected: [
                        state.selectedPdf,
                    ],
                })}
                    ${listen(ViraDropdown.events.selectedValuesChange, (event) => {
                        assert.isLengthExactly(event.detail, 1);
                        updateState({
                            selectedPdf: event.detail[0],
                        });
                    })}
                ></${ViraDropdown}>
                <${ViraDropdown.assign({
                    label: 'Mode',
                    options: getObjectTypedValues(DemoMode).map((mode) => {
                        return {
                            value: mode,
                            label: demoModeLabels[mode],
                        };
                    }),
                    selected: [
                        state.mode,
                    ],
                })}
                    ${listen(ViraDropdown.events.selectedValuesChange, (event) => {
                        assert.isLengthExactly(event.detail, 1);
                        demoRouter.setRoute({
                            paths: [assertWrap.isEnumValue(event.detail[0], DemoMode)],
                        });
                    })}
                ></${ViraDropdown}>
                <${ViraButton.assign({
                    text: 'Reset demo',
                    icon: resetIcon,
                    color: ViraColorVariant.Danger,
                    buttonEmphasis: ViraEmphasis.Subtle,
                })}
                    ${listen('click', () => {
                        updateState({
                            formFieldsByPdf: {},
                            formValuesByPdf: {},
                            adoptedSignerName: '',
                        });
                        void state.localDbClient.current?.clear();
                    })}
                ></${ViraButton}>
            </div>
            ${modeTemplates[state.mode]()}
        `;
    },
    cleanup({state}) {
        state.routeListener.current?.();
    },
});
