# pdf-vir

A simple custom web element for rendering a PDF in a scrollable container of canvases.

## Install

```sh
npm i pdf-vir
```

## Usage

Usage within an [`element-vir`](https://www.npmjs.com/package/element-vir) element:

<!-- example-link: src/readme-examples/usage.example.ts -->

```TypeScript
import {defineElement, html} from 'element-vir';
import {PdfVir} from 'pdf-vir';

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
```

### PDFium WebAssembly file

`pdfiumWasmUrl` is a required input to `PdfVir`. This must be a copy of the PDFium WebAssembly binary placed somewhere in your frontend bundle. This can be obtained in many ways, including the following:

-   From `pdf-vir`: copy from `node_modules/pdf-vir/www-static/pdfium.wasm`
    -   Requires no extra dependencies, included directly in `pdf-vir` files for convenience.
-   From `@embedpdf/pdfium`: copy from `node_modules/@embedpdf/pdfium/dist/pdfium.wasm`
    -   Requires the [`@embedpdf/pdfium`](https://www.npmjs.com/package/@embedpdf/pdfium) package, which is a peer dependency of this package.
