import {init, type WrappedPdfiumModule} from '@embedpdf/pdfium';

/**
 * Cache `init` results per wasm URL so multiple `<pdf-vir>` instances share a single pdfium
 * instance (loading the wasm again is wasteful and `PDFiumExt_Init` is meant to run once per
 * module).
 */
const pdfiumByWasmUrl = new Map<string, Promise<WrappedPdfiumModule>>();

function loadPdfiumFromUrl(wasmUrl: string): Promise<WrappedPdfiumModule> {
    return (async () => {
        const response = await fetch(wasmUrl);
        if (!response.ok) {
            throw new Error(
                `Failed to fetch pdfium wasm from '${wasmUrl}': ${response.status} ${response.statusText}`,
            );
        }
        const wasmBinary = await response.arrayBuffer();
        const pdfium = await init({
            wasmBinary,
        });
        pdfium.PDFiumExt_Init();
        return pdfium;
    })();
}

/**
 * Loads the pdfium WebAssembly module from the given URL and runs its required `PDFiumExt_Init`
 * step. The returned promise is cached per URL so concurrent and subsequent calls reuse the same
 * module instance.
 *
 * @category Internal
 */
export function loadPdfium(wasmUrl: string | URL): Promise<WrappedPdfiumModule> {
    const key = wasmUrl instanceof URL ? wasmUrl.href : wasmUrl;
    const existing = pdfiumByWasmUrl.get(key);
    if (existing) {
        return existing;
    }
    const created = loadPdfiumFromUrl(key).catch((error: unknown) => {
        /*
         * Drop the cache entry on failure so a subsequent attempt (e.g. after a network blip) can
         * retry instead of getting the rejected promise forever.
         */
        pdfiumByWasmUrl.delete(key);
        throw error;
    });
    pdfiumByWasmUrl.set(key, created);
    return created;
}
