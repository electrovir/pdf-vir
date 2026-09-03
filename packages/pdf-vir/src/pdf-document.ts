import {check} from '@augment-vir/assert';
import {createArray} from '@augment-vir/common';
import {type WrappedPdfiumModule} from '@embedpdf/pdfium';
import {type PdfSource, type PdfSourceOptions} from './pdf-source.js';
import {loadPdfium} from './pdfium-loader.js';

// cspell:words bgra, 0xAARRGGBB, fpdf, HEAPU8, SIZEF

/** PDFium bitmap format constant for 32-bit BGRA. */
const bitmapFormatBgra = 4;
/** Solid white as BGRA (0xAARRGGBB). Used as the page background before rendering. */
const whiteBgra = 0xff_ff_ff_ff;
/** Bytes in the WASM heap's `float`, used to walk PDFium's `FS_SIZEF` output struct. */
const sizeOfFloat = 4;

/**
 * A loaded PDF document. Wraps a PDFium document handle and the WASM module that owns it. Pages are
 * loaded and rendered on demand via the `renderPage` method; call `destroy` once to free the native
 * resources it holds.
 *
 * @category Internal
 */
export class PdfDocument {
    public readonly pageCount: number;

    protected isDestroyed = false;

    /**
     * Scratch space for `getPageSize` to receive PDFium's `FS_SIZEF` struct, allocated on first use
     * and freed by `destroy`.
     *
     * Reading a document's page sizes means one of these per page, and the allocation costs more
     * than the size lookup it exists for: reading all 5000 pages of a document takes 8.4ms with a
     * buffer per page against 3.5ms with this one.
     */
    protected pageSizePtr: undefined | number = undefined;

    /**
     * Constructs a `PdfDocument` from already-loaded PDFium handles. Treat as internal: callers
     * should use {@link loadPdfDocument} instead, which performs the malloc + `FPDF_LoadMemDocument`
     * dance correctly. Constructing one with arbitrary pointers crashes the WASM module.
     */
    constructor(
        public readonly pdfium: WrappedPdfiumModule,
        public readonly source: PdfSource,
        protected readonly documentPtr: number,
        protected readonly dataPtr: number,
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
     *
     * The returned context is left scaled to PDF points, so drawing on top of the rendered page
     * uses the same coordinates the PDF itself does regardless of the render scale.
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

            /*
             * Leave the context in PDF-point space (1/72 inch per unit) so callers can draw
             * overlays using the PDF's own coordinates instead of tracking the render scale.
             * Applied after `putImageData`, which ignores the transform anyway.
             */
            context.setTransform(scale, 0, 0, scale, 0, 0);

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
     * Reads a page's intrinsic size in points without loading the page, which is cheap enough to
     * call for every page up front. Returns `undefined` if PDFium can't read the size.
     *
     * Rotation is accounted for, so this matches what {@link renderPage} reports.
     */
    public getPageSize(
        pageNumber: number,
    ): undefined | {widthPoints: number; heightPoints: number} {
        if (this.isDestroyed) {
            return undefined;
        }
        this.pageSizePtr ??= this.pdfium.pdfium.wasmExports.malloc(sizeOfFloat * 2) || undefined;
        const sizePtr = this.pageSizePtr;
        if (
            !sizePtr ||
            !this.pdfium.FPDF_GetPageSizeByIndexF(this.documentPtr, pageNumber - 1, sizePtr)
        ) {
            return undefined;
        }
        return {
            widthPoints: this.pdfium.pdfium.getValue(sizePtr, 'float'),
            heightPoints: this.pdfium.pdfium.getValue(sizePtr + sizeOfFloat, 'float'),
        };
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
        if (this.pageSizePtr) {
            this.pdfium.pdfium.wasmExports.free(this.pageSizePtr);
            this.pageSizePtr = undefined;
        }
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
    const {dataPtr, byteLength, password} = await loadSourceIntoHeap({
        pdfium,
        source,
    });
    const documentPtr = pdfium.FPDF_LoadMemDocument(dataPtr, byteLength, password ?? '');
    if (!documentPtr) {
        pdfium.pdfium.wasmExports.free(dataPtr);
        throw new Error(getLoadErrorMessage(pdfium));
    }
    return new PdfDocument(pdfium, source, documentPtr, dataPtr);
}

/** A block of PDFium heap memory holding a PDF's bytes, owned by the caller until it is freed. */
type HeapBytes = {
    dataPtr: number;
    /** Bytes actually written. The allocation itself may be larger. */
    byteLength: number;
};

async function loadSourceIntoHeap({
    pdfium,
    source,
}: {
    pdfium: WrappedPdfiumModule;
    source: PdfSource;
}): Promise<HeapBytes & {password?: string | undefined}> {
    if (typeof source === 'string' || source instanceof URL) {
        return await fetchIntoHeap({
            pdfium,
            url: source,
        });
    } else if (source instanceof ArrayBuffer) {
        return copyIntoHeap({
            pdfium,
            bytes: new Uint8Array(source),
        });
    } else if (ArrayBuffer.isView(source)) {
        return copyIntoHeap({
            pdfium,
            bytes: toUint8View(source),
        });
    }

    const options: PdfSourceOptions = source;
    if (options.data) {
        const data = options.data;
        return {
            ...copyIntoHeap({
                pdfium,
                bytes: data instanceof ArrayBuffer ? new Uint8Array(data) : toUint8View(data),
            }),
            password: options.password,
        };
    } else if (options.url) {
        return {
            ...(await fetchIntoHeap({
                pdfium,
                url: options.url,
                fetchOptions: options.fetchOptions,
            })),
            password: options.password,
        };
    } else {
        throw new Error('PdfSource requires either a `url` or `data` property.');
    }
}

function allocateHeap({pdfium, size}: {pdfium: WrappedPdfiumModule; size: number}): number {
    const dataPtr = pdfium.pdfium.wasmExports.malloc(size);
    if (!dataPtr) {
        throw new Error('Failed to allocate PDFium memory for PDF data.');
    }
    return dataPtr;
}

function copyIntoHeap({
    pdfium,
    bytes,
}: {
    pdfium: WrappedPdfiumModule;
    bytes: Uint8Array;
}): HeapBytes {
    const dataPtr = allocateHeap({
        pdfium,
        size: bytes.byteLength,
    });
    pdfium.pdfium.HEAPU8.set(bytes, dataPtr);
    return {
        dataPtr,
        byteLength: bytes.byteLength,
    };
}

async function fetchIntoHeap({
    pdfium,
    url,
    fetchOptions,
}: {
    pdfium: WrappedPdfiumModule;
    url: string | URL;
    fetchOptions?: RequestInit | undefined;
}): Promise<HeapBytes> {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
        throw new Error(
            `Failed to fetch PDF from '${String(url)}': ${response.status} ${response.statusText}`,
        );
    }
    return (
        (await streamIntoHeap({
            pdfium,
            response,
        })) ??
        copyIntoHeap({
            pdfium,
            bytes: new Uint8Array(await response.arrayBuffer()),
        })
    );
}

/**
 * Copies a fetched PDF into the PDFium heap as its bytes arrive, so the file never exists in a JS
 * buffer and the heap at the same time. Peak memory becomes the file plus one chunk instead of
 * twice the file: loading a 36MB PDF costs the renderer process about 30MB less at its peak.
 *
 * This is a peak, not a floor. What the tab keeps for good is the PDFium heap, which grows to hold
 * the file and can never shrink back, and that is the same size whichever path gets the bytes
 * there. Buffering only adds a second copy alongside it for the duration of the load — which is
 * still worth avoiding, since the peak is what gets a tab killed on a phone.
 *
 * Sizing the allocation up front needs a `Content-Length`. Returns `undefined` when the response
 * doesn't carry a usable one, before reading any of the body, so the caller can fall back to
 * buffering the whole thing.
 */
async function streamIntoHeap({
    pdfium,
    response,
}: {
    pdfium: WrappedPdfiumModule;
    response: Response;
}): Promise<undefined | HeapBytes> {
    const contentLength = Number(response.headers.get('content-length'));
    if (!response.body || !Number.isSafeInteger(contentLength) || contentLength <= 0) {
        return undefined;
    }

    const reader = response.body.getReader();
    let dataPtr = allocateHeap({
        pdfium,
        size: contentLength,
    });
    let allocatedSize = contentLength;
    let byteLength = 0;

    try {
        for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
            if (byteLength + chunk.value.byteLength > allocatedSize) {
                /*
                 * `Content-Length` counts encoded bytes, so a server that gzips the response
                 * under-reports the size the decoded body needs. Rare for a PDF, which is already
                 * compressed, but overrunning the allocation would corrupt the heap.
                 */
                const grownSize = Math.max(byteLength + chunk.value.byteLength, allocatedSize * 2);
                const grownPtr = allocateHeap({
                    pdfium,
                    size: grownSize,
                });
                pdfium.pdfium.HEAPU8.copyWithin(grownPtr, dataPtr, dataPtr + byteLength);
                pdfium.pdfium.wasmExports.free(dataPtr);
                dataPtr = grownPtr;
                allocatedSize = grownSize;
            }
            /*
             * Re-read `HEAPU8` every chunk. A `malloc` above can grow the WASM memory, which
             * detaches the old view's buffer and leaves writes through it throwing.
             */
            pdfium.pdfium.HEAPU8.set(chunk.value, dataPtr + byteLength);
            byteLength += chunk.value.byteLength;
        }
    } catch (error) {
        pdfium.pdfium.wasmExports.free(dataPtr);
        throw error;
    }

    return {
        dataPtr,
        byteLength,
    };
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
    const rowBytes = pixelWidth * 4;
    const imageData = toImageData({
        context,
        heap,
        bufferPtr,
        stride,
        rowBytes,
        pixelWidth,
        pixelHeight,
    });
    const dst = imageData.data;

    /*
     * Swap B and R channels in-place. PDFium produces little-endian BGRA (memory order B, G, R,
     * A) but canvas `ImageData` expects RGBA. Operating on a `Uint32Array` view lets us flip
     * each pixel in a single masked read/write rather than four byte-level loads per pixel.
     *
     * "In place" can mean inside PDFium's own bitmap, which {@link toImageData} hands over
     * directly. That's safe because the bitmap is destroyed as soon as this returns.
     *
     * An indexed loop rather than `forEach`: this runs once per pixel, up to `maxPixelsPerPage`
     * times per render, and skipping the per-element callback measurably shortens the main-thread
     * block on low-power devices.
     */
    const dst32 = new Uint32Array(dst.buffer, dst.byteOffset, dst.byteLength / 4);
    for (let index = 0; index < dst32.length; index++) {
        const value = dst32[index] as number;
        dst32[index] = (value & 0xff_00_ff_00) | ((value & 0xff) << 16) | ((value >>> 16) & 0xff);
    }

    context.putImageData(imageData, 0, 0);
}

/**
 * Wraps PDFium's rendered bitmap in an `ImageData` for {@link writeBitmapToContext} to hand to
 * `putImageData`.
 *
 * The `ImageData` constructor adopts the array it's given rather than copying it, so pointing it
 * straight at the WASM heap means the page exists twice during a render (PDFium's bitmap and the
 * canvas) instead of three times. The saving matters most exactly where it hurts: a page rendered
 * at the 6 megapixel budget a mid-range phone gets peaks at 48MB this way rather than 72MB.
 *
 * PDFium only pads rows for some pixel formats, never for the 32-bit BGRA this renders into. When
 * `stride` disagrees anyway, or when the buffer isn't 4-byte aligned for the channel swap's
 * `Uint32Array` view, fall back to copying row by row and skipping any padding.
 */
function toImageData({
    context,
    heap,
    bufferPtr,
    stride,
    rowBytes,
    pixelWidth,
    pixelHeight,
}: {
    context: CanvasRenderingContext2D;
    heap: Uint8Array;
    bufferPtr: number;
    stride: number;
    rowBytes: number;
    pixelWidth: number;
    pixelHeight: number;
}): ImageData {
    /**
     * `ImageData` won't take a view over a `SharedArrayBuffer`, which is what the heap would be if
     * pdfium were ever built with threads.
     */
    const heapBuffer = heap.buffer;
    if (stride === rowBytes && bufferPtr % 4 === 0 && check.instanceOf(heapBuffer, ArrayBuffer)) {
        return new ImageData(
            new Uint8ClampedArray(heapBuffer, bufferPtr, rowBytes * pixelHeight),
            pixelWidth,
            pixelHeight,
        );
    }

    const imageData = context.createImageData(pixelWidth, pixelHeight);
    createArray(pixelHeight, (row) => row).forEach((row) => {
        const rowStart = bufferPtr + row * stride;
        imageData.data.set(heap.subarray(rowStart, rowStart + rowBytes), row * rowBytes);
    });

    return imageData;
}
