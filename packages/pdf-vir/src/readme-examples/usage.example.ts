import {defineElement, html} from 'element-vir';
import {PdfVir} from '../index.js';

export const MyApp = defineElement()({
    tagName: 'my-app',
    render() {
        return html`
            <${PdfVir.assign({
                pdfSource: '/my-file.pdf',

                pdfiumWasmUrl: '/pdfium.wasm',
            })}></${PdfVir}>
        `;
    },
});
