import {defineElement, html} from 'element-vir';
import {PdfVir} from '../index.js';

export const MyApp = defineElement()({
    tagName: 'my-app',
    render() {
        return html`
            <${PdfVir.assign({
                pdfPath: '/my-file.pdf',

                pdfJsWorkerPath: '/pdf.worker.mjs',
            })}></${PdfVir}>
        `;
    },
});
