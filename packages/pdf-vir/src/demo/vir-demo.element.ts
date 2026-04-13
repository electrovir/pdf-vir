import {css, defineElement, html, listen} from 'element-vir';
import {PdfVir} from '../pdf-vir.element.js';

export const VirDemo = defineElement()({
    tagName: 'vir-demo',
    styles: css`
        :host {
            display: flex;
            align-items: start;
            justify-content: center;
            height: 100%;
            width: 100%;
        }

        ${PdfVir} {
            width: 80%;
            height: 90%;
        }
    `,
    render() {
        return html`
            <${PdfVir.assign({pdfSource: '/demo.pdf', pdfJsWorkerPath: '/pdf.worker.mjs'})}
                ${listen(PdfVir.events.canvasLoad, (event) => {
                    const {context, pageNumber} = event.detail;

                    if (pageNumber === 1) {
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
