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

                pdfJsWorkerPath: '/pdf.worker.mjs',
            })}></${PdfVir}>
        `;
    },
});
```

### Worker file

`pdfJsWorkerPath` is a required input to `PdfVir`. This must be a copy of the `pdfjs-dist` worker script placed somewhere in your frontend bundle. This can be obtained in many ways, including the following:

-   From `pdf-vir`: copy from `node_modules/pdf-vir/www-static/pdf.worker.mjs`
    -   Requires no extra dependencies, included directly in `pdf-vir` files for convenience.
-   From `pdfjs-dist`: copy from `node_modules/pdfjs-dist/build/pdf.worker.mjs`
    -   Requires the [`pdfjs-dist`](https://www.npmjs.com/package/pdfjs-dist) package, which _is_ already included as a dependency of this package.
