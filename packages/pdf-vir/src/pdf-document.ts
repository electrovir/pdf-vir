import {createArray} from '@augment-vir/common';
import {type WrappedPdfiumModule} from '@embedpdf/pdfium';
import {type PdfSource, type PdfSourceOptions} from './pdf-source.js';
import {loadPdfium} from './pdfium-loader.js';

// cspell:words bgra, 0xAARRGGBB, fpdf, HEAPU8

/** PDFium bitmap format constant for 32-bit BGRA. */
const bitmapFormatBgra = 4;
/** Solid white as BGRA (0xAARRGGBB). Used as the page background before rendering. */
const whiteBgra = 0xff_ff_ff_ff;

/**
 * A loaded PDF document. Wraps a PDFium document handle and the WASM module that owns it. Pages are
 * loaded and rendered on demand via the `renderPage` method; call `destroy` once to free the native
 * resources it holds.
 *
 * @category Internal
 */
export class PdfDocument {
    public readonly pageCount: number;

    private isDestroyed = false;

    /**
     * Constructs a `PdfDocument` from already-loaded PDFium handles. Treat as internal: callers
     * should use {@link loadPdfDocument} instead, which performs the malloc + `FPDF_LoadMemDocument`
     * dance correctly. Constructing one with arbitrary pointers crashes the WASM module.
     */
    constructor(
        public readonly pdfium: WrappedPdfiumModule,
        public readonly source: PdfSource,
        private readonly documentPtr: number,
        private readonly dataPtr: number,
    ) {
        this.pageCount = pdfium.FPDF_GetPageCount(documentPtr);
    }

    /**
     * Loads, renders, and immediately closes the page at the given 1-based page number. The
     * rendered pixels are written into the supplied canvas. Pages are not cached: each call
     * re-loads the page so PDFium can release its parsed state once the canvas pixels are baked in,
     * keeping memory bounded across large documents.
     *
     * `computeScale` runs after the page loads with the page's intrinsic point dimensions so
     * callers can clamp the render scale (e.g. to keep the canvas pixel buffer below a memory cap)
     * without paying for a second page load.
     */
    public renderPage({
        pageNumber,
        canvas,
        computeScale,
    }: {
        pageNumber: number;
        canvas: HTMLCanvasElement;
        computeScale: (pageSize: {widthPoints: number; heightPoints: number}) => number;
    }): {
        context: CanvasRenderingContext2D;
        widthPoints: number;
        heightPoints: number;
        scale: number;
    } {
        if (this.isDestroyed) {
            throw new Error('Cannot render a page on a destroyed PdfDocument.');
        }
        const pdfium = this.pdfium;
        const pagePtr = pdfium.FPDF_LoadPage(this.documentPtr, pageNumber - 1);
        if (!pagePtr) {
            throw new Error(`Failed to load PDF page ${String(pageNumber)}.`);
        }
        try {
            const widthPoints = pdfium.FPDF_GetPageWidthF(pagePtr);
            const heightPoints = pdfium.FPDF_GetPageHeightF(pagePtr);
            const scale = computeScale({
                widthPoints,
                heightPoints,
            });
            const pixelWidth = Math.max(1, Math.round(widthPoints * scale));
            const pixelHeight = Math.max(1, Math.round(heightPoints * scale));

            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
            const context = canvas.getContext('2d');
            if (!context) {
                throw new Error('Failed to acquire 2D rendering context for canvas.');
            }

            const bitmapPtr = pdfium.FPDFBitmap_CreateEx(
                pixelWidth,
                pixelHeight,
                bitmapFormatBgra,
                0,
                0,
            );
            if (!bitmapPtr) {
                throw new Error('Failed to allocate PDFium bitmap.');
            }
            try {
                pdfium.FPDFBitmap_FillRect(bitmapPtr, 0, 0, pixelWidth, pixelHeight, whiteBgra);
                pdfium.FPDF_RenderPageBitmap(
                    bitmapPtr,
                    pagePtr,
                    0,
                    0,
                    pixelWidth,
                    pixelHeight,
                    0,
                    0,
                );
                writeBitmapToContext({
                    pdfium,
                    bitmapPtr,
                    pixelWidth,
                    pixelHeight,
                    context,
                });
            } finally {
                pdfium.FPDFBitmap_Destroy(bitmapPtr);
            }

            return {
                context,
                widthPoints,
                heightPoints,
                scale,
            };
        } finally {
            pdfium.FPDF_ClosePage(pagePtr);
        }
    }

    /**
     * Frees the native PDFium document and its backing data buffer. Safe to call multiple times;
     * subsequent calls are no-ops.
     */
    public destroy(): void {
        if (this.isDestroyed) {
            return;
        }
        this.isDestroyed = true;
        this.pdfium.FPDF_CloseDocument(this.documentPtr);
        this.pdfium.pdfium.wasmExports.free(this.dataPtr);
    }
}

/**
 * Loads `source` into a {@link PdfDocument}. Fetches `pdfiumWasmUrl` (cached per URL) on first call
 * to bring up the PDFium WebAssembly module.
 *
 * @category Internal
 */
export async function loadPdfDocument({
    source,
    pdfiumWasmUrl,
}: {
    source: PdfSource;
    pdfiumWasmUrl: string | URL;
}): Promise<PdfDocument> {
    const pdfium = await loadPdfium(pdfiumWasmUrl);
    const {bytes, password} = await resolveSource(source);
    const dataPtr = pdfium.pdfium.wasmExports.malloc(bytes.byteLength);
    if (!dataPtr) {
        throw new Error('Failed to allocate PDFium memory for PDF data.');
    }
    pdfium.pdfium.HEAPU8.set(bytes, dataPtr);
    const documentPtr = pdfium.FPDF_LoadMemDocument(dataPtr, bytes.byteLength, password ?? '');
    if (!documentPtr) {
        pdfium.pdfium.wasmExports.free(dataPtr);
        throw new Error(getLoadErrorMessage(pdfium));
    }
    return new PdfDocument(pdfium, source, documentPtr, dataPtr);
}

async function resolveSource(
    source: PdfSource,
): Promise<{bytes: Uint8Array; password?: string | undefined}> {
    if (typeof source === 'string' || source instanceof URL) {
        return {
            bytes: await fetchPdfBytes(source),
        };
    } else if (source instanceof ArrayBuffer) {
        return {
            bytes: new Uint8Array(source),
        };
    } else if (ArrayBuffer.isView(source)) {
        return {
            bytes: toUint8View(source),
        };
    }

    const options: PdfSourceOptions = source;
    if (options.data) {
        const data = options.data;
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : toUint8View(data);
        return {
            bytes,
            password: options.password,
        };
    } else if (options.url) {
        return {
            bytes: await fetchPdfBytes(options.url, options.fetchOptions),
            password: options.password,
        };
    }
    throw new Error('PdfSource requires either a `url` or `data` property.');
}

async function fetchPdfBytes(
    url: string | URL,
    fetchOptions?: RequestInit | undefined,
): Promise<Uint8Array> {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
        throw new Error(
            `Failed to fetch PDF from '${String(url)}': ${response.status} ${response.statusText}`,
        );
    }
    return new Uint8Array(await response.arrayBuffer());
}

function toUint8View(view: ArrayBufferView): Uint8Array {
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/** Maps PDFium's `FPDF_GetLastError` codes onto user-readable messages. */
const lastErrorMessages: Readonly<Record<number, string>> = {
    1: 'Unknown error.',
    2: 'File not found or could not be opened.',
    3: 'File is not a valid PDF.',
    4: 'PDF file is corrupted.',
    5: 'Password required or invalid password supplied.',
    6: 'Unsupported PDF security scheme.',
    7: 'Page not found or content error.',
};

function getLoadErrorMessage(pdfium: WrappedPdfiumModule): string {
    const code = pdfium.FPDF_GetLastError();
    const detail = lastErrorMessages[code] || `PDFium error code ${String(code)}.`;
    return `Failed to load PDF: ${detail}`;
}

function writeBitmapToContext({
    pdfium,
    bitmapPtr,
    pixelWidth,
    pixelHeight,
    context,
}: {
    pdfium: WrappedPdfiumModule;
    bitmapPtr: number;
    pixelWidth: number;
    pixelHeight: number;
    context: CanvasRenderingContext2D;
}): void {
    const bufferPtr = pdfium.FPDFBitmap_GetBuffer(bitmapPtr);
    const stride = pdfium.FPDFBitmap_GetStride(bitmapPtr);
    const heap = pdfium.pdfium.HEAPU8;
    const imageData = context.createImageData(pixelWidth, pixelHeight);
    const dst = imageData.data;
    const rowBytes = pixelWidth * 4;

    /*
     * Copy the rendered bitmap into the canvas backing store row by row. Honors `stride` (which
     * may exceed `rowBytes` if PDFium pads rows) by skipping the padding bytes between rows.
     */
    createArray(pixelHeight, (y) => y).forEach((y) => {
        const srcStart = bufferPtr + y * stride;
        dst.set(heap.subarray(srcStart, srcStart + rowBytes), y * rowBytes);
    });

    /*
     * Swap B and R channels in-place. PDFium produces little-endian BGRA (memory order B, G, R,
     * A) but canvas `ImageData` expects RGBA. Operating on a `Uint32Array` view lets us flip
     * each pixel in a single masked read/write rather than four byte-level loads per pixel.
     */
    const dst32 = new Uint32Array(dst.buffer, dst.byteOffset, dst.byteLength / 4);
    dst32.forEach((value, index) => {
        dst32[index] = (value & 0xff_00_ff_00) | ((value & 0xff) << 16) | ((value >>> 16) & 0xff);
    });

    context.putImageData(imageData, 0, 0);
}
