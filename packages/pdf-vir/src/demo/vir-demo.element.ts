/// <reference types="vite/client" />

import {assert, assertWrap} from '@augment-vir/assert';
import {getObjectTypedValues, omitObjectKeys} from '@augment-vir/common';
import {css, defineElement, html, listen, nothing, type HtmlInterpolation} from 'element-vir';
import {
    ViraButton,
    ViraColorVariant,
    ViraDropdown,
    ViraEmphasis,
    viraTheme,
    ViraThemeSwitcher,
    type ViraDropdownOption,
} from 'vira';
import {pdfVirIcons} from '../icons.js';
import {type PdfFormAssignee} from '../pdf-form-assignee.js';
import {pdfFormFieldConfig, type PdfFormField} from '../pdf-form-field.js';
import {findUnfilledRequiredPdfFormFields, type PdfFormValues} from '../pdf-form-value.js';
import {PdfVirFormEditor} from '../pdf-vir-form-editor.element.js';
import {PdfVirFormFiller} from '../pdf-vir-form-filler.element.js';
import {PdfVir} from '../pdf-vir.element.js';
import {
    createDemoFrontendState,
    DemoMode,
    demoRouter,
    type DemoFrontendState,
} from './demo-frontend-state.js';

const demoModeLabels: Record<DemoMode, string> = {
    [DemoMode.Viewer]: 'View',
    [DemoMode.FormEditor]: 'Build',
    [DemoMode.FormFiller]: 'Fill',
};

const committedDemoPath = '/demo.pdf';

const demoAssignees: ReadonlyArray<PdfFormAssignee> = [
    {
        id: 'signer-1',
        label: 'Signer 1',
    },
    {
        id: 'signer-2',
        label: 'Signer 2',
    },
];

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
            background-color: ${viraTheme.colors['theme-default'].background.value};
            color: ${viraTheme.colors['theme-default'].foreground.value};
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
            align-items: flex-end;
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
            frontendState: undefined as undefined | DemoFrontendState,
            formFieldsByPdf: {} as Partial<Record<string, PdfFormField[]>>,
            formValuesByPdf: {} as Partial<Record<string, PdfFormValues>>,
            adoptedSignerName: '',
            assignees: demoAssignees,
            fillingAssigneeId: demoAssignees[0]?.id,
        };
    },
    init({updateState}) {
        void createDemoFrontendState().then((frontendState) => {
            const savedValues = frontendState.value.localDbClient.value;
            updateState({
                frontendState,
                formFieldsByPdf: savedValues.formFields ?? {},
                formValuesByPdf: savedValues.formValues ?? {},
                adoptedSignerName: savedValues.adoptedSignerName || '',
                assignees: savedValues.assignees ?? demoAssignees,
            });
        });
    },
    render({state, updateState}) {
        if (!state.frontendState) {
            return nothing;
        }
        /** Aliased so the narrowing above holds inside the callbacks below. */
        const {localDbClient, themeClient, currentRoute} = state.frontendState.value;

        const modeTemplates: Record<DemoMode, () => HtmlInterpolation> = {
            [DemoMode.Viewer]: renderViewer,
            [DemoMode.FormEditor]() {
                return html`
                    <${PdfVirFormEditor.assign({
                        pdfSource: state.selectedPdf,
                        pdfiumWasmUrl: '/pdfium.wasm',
                        fields: state.formFieldsByPdf[state.selectedPdf] ?? [],
                        assignees: state.assignees,
                    })}
                        ${listen(PdfVirFormEditor.events.assigneesChange, (event) => {
                            updateState({
                                assignees: event.detail,
                            });
                            void localDbClient.set.assignees(event.detail);
                        })}
                        ${listen(PdfVirFormEditor.events.fieldsChange, (event) => {
                            const formFieldsByPdf = {
                                ...state.formFieldsByPdf,
                                [state.selectedPdf]: event.detail,
                            };
                            updateState({
                                formFieldsByPdf,
                            });
                            void localDbClient.set.formFields(formFieldsByPdf);
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
                    assigneeId: state.fillingAssigneeId,
                }).length;

                function saveValues(newValues: PdfFormValues) {
                    const formValuesByPdf = {
                        ...state.formValuesByPdf,
                        [state.selectedPdf]: newValues,
                    };
                    updateState({
                        formValuesByPdf,
                    });
                    void localDbClient.set.formValues(formValuesByPdf);
                }

                return html`
                    <div class="form-status">
                        <${ViraDropdown.assign({
                            label: 'Fill as',
                            options: state.assignees.map((assignee) => {
                                return {
                                    value: assignee.id,
                                    label: assignee.label,
                                };
                            }),
                            selected: state.fillingAssigneeId
                                ? [
                                      state.fillingAssigneeId,
                                  ]
                                : [],
                        })}
                            ${listen(ViraDropdown.events.selectedValuesChange, (event) => {
                                updateState({
                                    fillingAssigneeId: event.detail[0],
                                });
                            })}
                        ></${ViraDropdown}>
                        <p>
                            ${fields.length
                                ? unfilledCount
                                    ? `${unfilledCount} required field(s) left to fill.`
                                    : 'All required fields are filled.'
                                : 'Add fields in Build mode first.'}
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
                                          void localDbClient.delete.adoptedSignerName();
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
                        assigneeId: state.fillingAssigneeId,
                    })}
                        ${listen(PdfVirFormFiller.events.valuesChange, (event) => {
                            saveValues(event.detail.values);
                        })}
                        ${listen(PdfVirFormFiller.events.signerNameAdopt, (event) => {
                            updateState({
                                adoptedSignerName: event.detail,
                            });
                            void localDbClient.set.adoptedSignerName(event.detail);
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
                        currentRoute.paths[0],
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
                    icon: pdfVirIcons.reset,
                    color: ViraColorVariant.Danger,
                    buttonEmphasis: ViraEmphasis.Subtle,
                })}
                    ${listen('click', () => {
                        updateState({
                            formFieldsByPdf: {},
                            formValuesByPdf: {},
                            adoptedSignerName: '',
                            assignees: demoAssignees,
                            fillingAssigneeId: demoAssignees[0]?.id,
                        });
                        void localDbClient.delete.formFields();
                        void localDbClient.delete.formValues();
                        void localDbClient.delete.adoptedSignerName();
                        void localDbClient.delete.assignees();
                    })}
                ></${ViraButton}>
                <${ViraThemeSwitcher.assign({
                    themeClient,
                })}></${ViraThemeSwitcher}>
            </div>
            ${modeTemplates[currentRoute.paths[0]]()}
        `;
    },
    cleanup({state}) {
        state.frontendState?.destroy();
    },
});
