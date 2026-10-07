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

### Zoom controls

Pass `enableZoomControls: true` to render a floating Safari-style zoom toolbar (zoom out, zoom in, reset) over the top of the viewer. The toolbar appears when the cursor moves over the element and auto-hides after a short idle.

```TypeScript
<${PdfVir.assign({
    pdfSource: '/my-file.pdf',
    pdfiumWasmUrl: '/pdfium.wasm',
    enableZoomControls: true,
})}></${PdfVir}>
```

Zoom immediately scales the already-rendered canvases with CSS, then re-renders the pages on screen at the new zoom level once zooming settles, so they end up sharp instead of stretched. Off-screen pages re-render when they scroll back into view.

### Forms

`PdfVirFormEditor` lets a user build a fillable form on top of a PDF. They drag fields (text, date, checkbox, circle one, signature, initials) from a palette onto the pages, then move, resize, or mark them required. `PdfVirFormFiller` renders those same fields for someone to fill in.

Both elements are controlled: they only emit events with the full new data. Nothing changes on screen until you pass that data back in, so you decide where it's stored.

Pass `assignees` to the editor to let fields be assigned to different signers. Then pass an `assigneeId` to the filler to show only that signer's fields and the unassigned ones.

<!-- example-link: src/readme-examples/form.example.ts -->

```TypeScript
import {defineElement, html, listen} from 'element-vir';
import {
    PdfVirFormEditor,
    PdfVirFormFiller,
    type PdfFormAssignee,
    type PdfFormField,
    type PdfFormValues,
} from 'pdf-vir';

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
```
