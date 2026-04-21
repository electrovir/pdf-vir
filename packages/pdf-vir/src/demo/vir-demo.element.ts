/// <reference types="vite/client" />

import {css, defineElement, html, listen} from 'element-vir';
import {ViraSelect, type ViraSelectOption} from 'vira';
import {PdfVir} from '../pdf-vir.element.js';

const committedDemoPath = '/demo.pdf';

const extraPdfModules = import.meta.glob('../../www-static/extra-pdfs/*.pdf');

const extraPdfOptions: ReadonlyArray<ViraSelectOption> = Object.keys(extraPdfModules)
    .map((modulePath): ViraSelectOption => {
        const fileName = modulePath.split('/').pop() ?? modulePath;
        return {
            value: `/extra-pdfs/${fileName}`,
            label: fileName,
        };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

const pdfOptions: ReadonlyArray<ViraSelectOption> = [
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
        };
    },
    render({state, updateState}) {
        return html`
            <${ViraSelect.assign({
                label: 'PDF',
                options: pdfOptions,
                value: state.selectedPdf,
            })}
                ${listen(ViraSelect.events.valueChange, (event) => {
                    updateState({selectedPdf: event.detail});
                })}
            ></${ViraSelect}>
            <${PdfVir.assign({
                pdfSource: state.selectedPdf,
                pdfJsWorkerPath: '/pdf.worker.mjs',
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
    },
});
