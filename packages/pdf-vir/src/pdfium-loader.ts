import {DeferredPromise, ensureError, extractErrorMessage} from '@augment-vir/common';
import {init, type WrappedPdfiumModule} from '@embedpdf/pdfium';

/**
 * Cache `init` results per wasm URL so multiple `<pdf-vir>` instances share a single pdfium
 * instance (loading the wasm again is wasteful and `PDFiumExt_Init` is meant to run once per
 * module).
 */
const pdfiumByWasmUrl = new Map<string, Promise<WrappedPdfiumModule>>();

/**
 * Fetches and compiles the pdfium wasm, compiling the bytes already downloaded while the rest are
 * still arriving. The 4.6MB binary has to be compiled before a single page can render, and that
 * compile is not cheap on a weak device: on a mid-range phone, downloading and then compiling takes
 * 166ms against 60ms for the two overlapped.
 */
async function compileWasm({
    wasmUrl,
    imports,
}: {
    wasmUrl: string;
    imports: WebAssembly.Imports;
}): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
    const response = await fetch(wasmUrl);

    if (!response.ok) {
        throw new Error(
            `Failed to fetch pdfium wasm from '${wasmUrl}': ${response.status} ${response.statusText}`,
        );
    } else if (response.headers.get('content-type')?.includes('application/wasm')) {
        return await WebAssembly.instantiateStreaming(response, imports);
    } else {
        /*
         * `instantiateStreaming` rejects a response that isn't served as `application/wasm`.
         * Buffering keeps a host that mislabels the file working, at the cost of the compile no
         * longer overlapping the download.
         */
        try {
            return await WebAssembly.instantiate(await response.arrayBuffer(), imports);
        } catch (error) {
            /*
             * Landing here usually means the response isn't the wasm at all: a dev server or
             * single-page-app host that answers an unknown path with `index.html` rather than a
             * 404. Say so, because WebAssembly's own complaint about a bad magic word gives no
             * hint that `pdfiumWasmUrl` is pointed at the wrong place.
             */
            throw new Error(
                [
                    `Failed to compile pdfium wasm from '${wasmUrl}'`,
                    `(served as '${response.headers.get('content-type') || 'no content type'}',`,
                    "expected 'application/wasm'):",
                    extractErrorMessage(error),
                ].join(' '),
                {
                    cause: error,
                },
            );
        }
    }
}

function loadPdfiumFromUrl(wasmUrl: string): Promise<WrappedPdfiumModule> {
    /**
     * Emscripten hands `instantiateWasm` a callback for success and nothing for failure, so a
     * rejection inside it would otherwise leave `init` pending forever. Raced against `init` below
     * to surface the error instead of hanging.
     */
    const failure = new DeferredPromise<never>();

    const loading = init({
        /*
         * Emscripten already knows how to stream the compile, but only along the path where it
         * fetches the binary itself — handing it a `wasmBinary` buffer opts out. Taking over
         * instantiation keeps the streaming compile while leaving the fetch here, where a wrong
         * `pdfiumWasmUrl` still reports as itself rather than as an emscripten abort.
         */
        instantiateWasm(imports, onInstance) {
            compileWasm({
                wasmUrl,
                imports,
            })
                .then((compiled) => {
                    onInstance(compiled.instance);
                })
                .catch((error: unknown) => {
                    failure.reject(ensureError(error));
                });

            /* Anything but `false` tells emscripten the instance is coming later. */
            return {};
        },
    });

    return Promise.race([
        failure.promise,
        loading.then((pdfium) => {
            pdfium.PDFiumExt_Init();
            return pdfium;
        }),
    ]);
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
