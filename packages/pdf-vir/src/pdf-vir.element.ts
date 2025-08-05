import {assert} from '@augment-vir/assert';
import {createArray, extractErrorMessage, type PartialWithUndefined} from '@augment-vir/common';
import {
    asyncProp,
    attributes,
    type AttributeValues,
    css,
    type CSSResult,
    defineElement,
    defineElementEvent,
    html,
    ifDefined,
    onDomCreated,
} from 'element-vir';
import * as pdfjs from 'pdfjs-dist';
import {GlobalWorkerOptions, type PDFDocumentProxy} from 'pdfjs-dist';
import {LoaderAnimated24Icon, ViraIcon} from 'vira';

/**
 * All inputs for {@link PdfVir}.
 *
 * @category Internal
 */
export type PdfVirInputs = {
    pdfPath: string;
    /**
     * Used to set `GlobalWorkerOptions.workerSrc` on the PDFJs library. This is required or the
     * library simply crashes. This should be a string containing the path and filename of the
     * worker file. (Copy `node_modules/pdfjs-dist/build/pdf.worker.mjs` to your public directory.)
     */
    pdfJsWorkerPath: string;
} & PartialWithUndefined<{
    /**
     * The first page number to render.
     *
     * @default 1 // (the first page)
     */
    startPageNumber: number;
    /**
     * The number of pages to render.
     *
     * @default // the total page count
     */
    pageCount: number;
    stylePassthrough: PartialWithUndefined<Record<PdfVirElements, CSSResult>>;
    attributePassthrough: PartialWithUndefined<Record<PdfVirElements, AttributeValues>>;
}>;

/**
 * All internal elements of {@link PdfVir} that you can pass styles or attributes to.
 *
 * @category Internal
 */
export type PdfVirElements = 'canvas' | 'canvas-wrapper' | 'loader' | 'error';

/**
 * Event detail from the `pdfLoad` event and also part of the `canvasLoad` event.
 *
 * @category Internal
 */
export type PdfLoadEventDetail = {
    pageCount: number;
    pdfDocument: PDFDocumentProxy;
    pdfPath: string;
};

/**
 * An element-vir custom-web-element for rendering PDFs inline with HTML.
 *
 * @category Main
 */
export const PdfVir = defineElement<PdfVirInputs>()({
    tagName: 'pdf-vir',
    styles: css`
        :host {
            background-color: #999;
            display: flex;
            flex-direction: column;
            gap: 32px;
            width: 600px;
            height: 800px;
            max-width: 100%;
            overflow-y: scroll;
            padding: 32px;
        }

        .canvas-wrapper {
            position: relative;
            box-sizing: border-box;
            max-width: 100%;
        }

        canvas {
            max-width: 100%;
            box-sizing: border-box;
        }

        .error {
            width: 100%;
            max-height: 100%;
            box-sizing: border-box;
            font-weight: bold;
            color: red;
        }

        .loader {
            background-color: white;
            box-sizing: border-box;
            width: 100%;
            height: 200px;
            max-height: 100%;
            padding: 8px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
    `,
    events: {
        canvasLoad: defineElementEvent<
            {
                canvas: HTMLCanvasElement;
                context: CanvasRenderingContext2D;
                pageNumber: number;
            } & PdfLoadEventDetail
        >(),
        pdfLoad: defineElementEvent<PdfLoadEventDetail>(),
    },
    state({events, dispatch}) {
        return {
            pdfDocument: asyncProp({
                async updateCallback({pdfPath}: {pdfPath: string}) {
                    const pdfDocument = await pdfjs.getDocument(pdfPath).promise;
                    dispatch(
                        new events.pdfLoad({pageCount: pdfDocument.numPages, pdfDocument, pdfPath}),
                    );
                    return pdfDocument;
                },
            }),
            canvasElement: undefined as undefined | HTMLCanvasElement,
        };
    },
    render({state, inputs, dispatch, events}) {
        GlobalWorkerOptions.workerSrc = inputs.pdfJsWorkerPath;
        const pdfPath = inputs.pdfPath;
        state.pdfDocument.update({pdfPath: pdfPath});

        if (!state.pdfDocument.settledValue) {
            return html`
                <div
                    class="loader"
                    ${attributes(inputs.attributePassthrough?.loader)}
                    style=${ifDefined(inputs.stylePassthrough?.loader)}
                >
                    <${ViraIcon.assign({
                        icon: LoaderAnimated24Icon,
                    })}></${ViraIcon}>
                </div>
            `;
        } else if (state.pdfDocument.settledValue instanceof Error) {
            return html`
                <div
                    class="error"
                    ${attributes(inputs.attributePassthrough?.error)}
                    style=${ifDefined(inputs.stylePassthrough?.error)}
                >
                    PDF load failed:
                    ${extractErrorMessage(state.pdfDocument.settledValue) || 'Unknown Error'}
                </div>
            `;
        }

        const pdfDocument: PDFDocumentProxy = state.pdfDocument.settledValue;

        return createArray(
            pdfDocument.numPages,
            (index) => html`
                <div
                    class="canvas-wrapper"
                    ${attributes(inputs.attributePassthrough?.['canvas-wrapper'])}
                    style=${ifDefined(inputs.stylePassthrough?.['canvas-wrapper'])}
                >
                    <canvas
                        ${attributes(inputs.attributePassthrough?.canvas)}
                        style=${ifDefined(inputs.stylePassthrough?.canvas)}
                        ${onDomCreated(async (canvas) => {
                            const pageNumber = index + 1;

                            assert.instanceOf(canvas, HTMLCanvasElement);

                            const pdfPage = await pdfDocument.getPage(pageNumber);
                            const viewport = pdfPage.getViewport({scale: 1});

                            canvas.width = viewport.width;
                            canvas.height = viewport.height;
                            const context = canvas.getContext('2d');

                            assert.isDefined(context);

                            const renderTask = pdfPage.render({
                                canvasContext: context,
                                viewport,
                                canvas: canvas,
                            });
                            await renderTask.promise;
                            dispatch(
                                new events.canvasLoad({
                                    canvas,
                                    context,
                                    pageNumber,
                                    pageCount: pdfDocument.numPages,
                                    pdfPath,
                                    pdfDocument,
                                }),
                            );
                        })}
                    ></canvas>
                </div>
            `,
        );
    },
});
