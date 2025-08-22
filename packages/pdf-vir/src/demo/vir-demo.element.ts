import {css, defineElement, html, listen} from 'element-vir';
import {PdfVir} from '../pdf-vir.element.js';

export const VirDemo = defineElement()({
    tagName: 'vir-demo',
    styles: css`
        :host {
            display: flex;
            align-items: center;
            justify-content: center;
            max-height: 100%;
            max-width: 100%;
            min-height: 100%;
            min-width: 100%;
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
