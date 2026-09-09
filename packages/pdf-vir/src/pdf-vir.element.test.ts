import {assert, waitUntil} from '@augment-vir/assert';
import {describe, it, testWeb} from '@augment-vir/test';
import {PdfScrollResult, PdfVir, scrollPdfToPage} from './pdf-vir.element.js';

/** Served from the package root by the test runner, the same files the demo page uses. */
const longPdfPath = '/www-static/extra-pdfs/post_acute_referral.pdf';
const shortPdfPath = '/www-static/demo.pdf';
const pdfiumWasmPath = '/www-static/pdfium.wasm';

/** The last page of the long PDF, far outside the mount margin at the top of the document. */
const lastPageNumber = 25;

async function renderPdfVir(pdfSource: string) {
    const element = await testWeb.renderElement(PdfVir, {
        pdfSource,
        pdfiumWasmUrl: pdfiumWasmPath,
    });
    /*
     * A custom element is inline by default, and an inline box ignores the size `:host` sets, so
     * without this it grows to fit every page and never scrolls.
     */
    element.style.display = 'block';

    return element;
}

/**
 * Asserts that the last page of the long PDF is both mounted and in view. It's the last page, so
 * the scroll space runs out before its top reaches the top of the view: the exact landing spot is
 * the bottom of the scroll space.
 */
function assertScrolledToLastPage(element: (typeof PdfVir)['InstanceType']) {
    const scrollContainer = element.shadowRoot.querySelector('.scroll-container');
    assert.instanceOf(scrollContainer, HTMLElement);

    assert.isAtLeast(element.instanceState.pageWindow.lastIndex, lastPageNumber - 1);
    assert.strictEquals(
        scrollContainer.scrollTop,
        scrollContainer.scrollHeight - scrollContainer.clientHeight,
    );
}

describe(scrollPdfToPage.name, () => {
    it('scrolls to a page that is not mounted yet', async () => {
        const element = await renderPdfVir(longPdfPath);
        await waitUntil.isTruthy(() => element.instanceState.pageSizes.current);
        assert.isBelow(
            element.instanceState.pageWindow.lastIndex,
            lastPageNumber - 1,
            'the last page should start out unmounted, or this test proves nothing',
        );

        assert.strictEquals(
            await scrollPdfToPage({
                element,
                pageNumber: lastPageNumber,
            }),
            PdfScrollResult.Scrolled,
        );
        assertScrolledToLastPage(element);
    });

    it('waits for a document that is still loading instead of doing nothing', async () => {
        const element = await renderPdfVir(longPdfPath);

        /* Deliberately not waiting for the load: this is the case a consumer hits on first paint. */
        assert.strictEquals(
            await scrollPdfToPage({
                element,
                pageNumber: lastPageNumber,
            }),
            PdfScrollResult.Scrolled,
        );
        assertScrolledToLastPage(element);
    });

    it('gives a queued request up to a newer one', async () => {
        const element = await renderPdfVir(longPdfPath);
        const firstRequest = scrollPdfToPage({
            element,
            pageNumber: 2,
        });
        const secondRequest = scrollPdfToPage({
            element,
            pageNumber: lastPageNumber,
        });

        assert.strictEquals(await firstRequest, PdfScrollResult.Superseded);
        assert.strictEquals(await secondRequest, PdfScrollResult.Scrolled);
        assertScrolledToLastPage(element);
    });

    it('drops a queued request when the source changes', async () => {
        const element = await renderPdfVir(longPdfPath);
        const scrollPromise = scrollPdfToPage({
            element,
            pageNumber: lastPageNumber,
        });
        element.assignInputs({
            pdfSource: shortPdfPath,
        });

        assert.strictEquals(await scrollPromise, PdfScrollResult.Dropped);
    });

    it('rejects a page the document does not have', async () => {
        const element = await renderPdfVir(shortPdfPath);
        await waitUntil.isTruthy(() => element.instanceState.pageSizes.current);

        await assert.throws(
            scrollPdfToPage({
                element,
                pageNumber: 500,
            }),
            {
                matchMessage: 'this PDF has 4 pages',
            },
        );
    });

    it('rejects a page number below the first page', async () => {
        const element = await renderPdfVir(shortPdfPath);

        await assert.throws(
            scrollPdfToPage({
                element,
                pageNumber: 0,
            }),
            {
                matchMessage: 'page numbers start at 1',
            },
        );
    });
});
