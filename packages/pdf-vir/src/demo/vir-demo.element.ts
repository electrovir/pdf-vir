import {css, defineElement, html, listen} from 'element-vir';
import {PdfVir} from '../pdf-vir.element.js';

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
            box-sizing: border-box;
        }

        ${PdfVir} {
            flex-grow: 1;
            box-sizing: border-box;
            overscroll-behavior: contain;
        }
    `,
    render() {
        return html`
            <${PdfVir.assign({
                pdfSource: '/demo.pdf',
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
                    const {context, pageNumber, scale} = event.detail;

                    if (pageNumber === 1) {
                        context.beginPath();
                        /** Render a box in PDF-coordinate space, scaled to canvas pixels. */
                        context.rect(90 * scale, 125 * scale, 210 * scale, 25 * scale);
                        context.lineWidth = 3 * scale;
                        context.strokeStyle = 'red';
                        context.stroke();
                    }
                })}
            ></${PdfVir}>
        `;
    },
});
