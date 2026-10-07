import {defineElement, html, listen} from 'element-vir';
import {
    PdfVirFormEditor,
    PdfVirFormFiller,
    type PdfFormAssignee,
    type PdfFormField,
    type PdfFormValues,
} from '../index.js';

export const MyFormApp = defineElement()({
    tagName: 'my-form-app',
    state() {
        return {
            fields: [] as PdfFormField[],
            assignees: [
                {
                    id: 'signer-1',
                    label: 'Signer 1',
                },
            ] as PdfFormAssignee[],
            values: {} as PdfFormValues,
            adoptedSignerName: '',
        };
    },
    render({state, updateState}) {
        return html`
            <${PdfVirFormEditor.assign({
                pdfSource: '/my-file.pdf',
                pdfiumWasmUrl: '/pdfium.wasm',
                fields: state.fields,
                assignees: state.assignees,
            })}
                ${listen(PdfVirFormEditor.events.fieldsChange, (event) => {
                    updateState({
                        fields: event.detail,
                    });
                })}
                ${listen(PdfVirFormEditor.events.assigneesChange, (event) => {
                    updateState({
                        assignees: event.detail,
                    });
                })}
            ></${PdfVirFormEditor}>

            <${PdfVirFormFiller.assign({
                pdfSource: '/my-file.pdf',
                pdfiumWasmUrl: '/pdfium.wasm',
                fields: state.fields,
                values: state.values,
                adoptedSignerName: state.adoptedSignerName,
                assigneeId: 'signer-1',
            })}
                ${listen(PdfVirFormFiller.events.valuesChange, (event) => {
                    updateState({
                        values: event.detail.values,
                    });
                })}
                ${listen(PdfVirFormFiller.events.signerNameAdopt, (event) => {
                    updateState({
                        adoptedSignerName: event.detail,
                    });
                })}
            ></${PdfVirFormFiller}>
        `;
    },
});
