import {randomString, safeJsonStringify, sortObject} from '@augment-vir/common';

/**
 * Binary representations of PDF data accepted by `PdfSource` and {@link PdfSourceOptions.data}. Only
 * byte-granularity views are accepted: PDFium reads bytes, so a wider-element typed array (e.g.
 * `Float32Array`) would silently reinterpret its underlying buffer as PDF bytes — almost always a
 * bug. Pass a `Uint8Array` view over the same buffer instead.
 *
 * @category Internal
 */
export type PdfData = ArrayBuffer | Int8Array | Uint8Array | Uint8ClampedArray;

/**
 * Object form of {@link PdfSource} for callers that need to pass a password or fetch options
 * alongside the URL or binary data.
 *
 * @category Internal
 */
export type PdfSourceOptions = {
    /** PDF data to load directly. Mutually exclusive with `url`. */
    data?: PdfData;
    /**
     * URL to fetch the PDF from. Mutually exclusive with `data`. Standard same-origin / CORS rules
     * apply.
     */
    url?: string | URL;
    /** Password used to unlock encrypted PDFs. */
    password?: string;
    /** Extra options forwarded to `fetch` when loading from a URL. */
    fetchOptions?: RequestInit;
};

/**
 * All options for the PDF `pdfSource` property in `PdfVirInputs`.
 *
 * @category Internal
 */
export type PdfSource = string | URL | PdfData | PdfSourceOptions;

/**
 * Compares two possible pdf sources for equality, covering every variant of {@link PdfSource}:
 *
 * - Strings and `URL`s are compared structurally (including cross-type string↔`URL` via `.href`).
 * - Plain {@link PdfSourceOptions} objects are compared structurally via `JSON.stringify`, so a fresh
 *   object literal constructed on every render with the same fields counts as equal.
 * - Typed arrays and `ArrayBuffer`s use reference equality — hold onto the same instance to avoid
 *   re-loading. Any such binary value embedded inside a {@link PdfSourceOptions} object is also
 *   compared by reference while the rest of the object is compared structurally.
 *
 * @category Internal
 */
// eslint-disable-next-line @virmator/prefer-params-object
export function arePdfSourcesEqual(a: undefined | PdfSource, b: undefined | PdfSource): boolean {
    if (a == undefined || b == undefined) {
        return a === b;
    }
    return toPdfSourceKey(a) === toPdfSourceKey(b);
}

/**
 * Module-level registry that assigns a stable string key to each binary-typed source (or embedded
 * binary value) so subsequent passes over the same reference produce the same key. A `WeakMap`
 * ensures we don't keep sources alive once the caller drops them.
 */
const pdfSourceRefKeys = new WeakMap<object, string>();

function getOrCreateRefKey(value: object): string {
    const existing = pdfSourceRefKeys.get(value);
    if (existing) {
        return existing;
    }
    const generated = `ref:${randomString()}`;
    pdfSourceRefKeys.set(value, generated);
    return generated;
}

/**
 * Produces a stable string key for a {@link PdfSource}, matching the semantics of
 * {@link arePdfSourcesEqual}:
 *
 * - Strings and `URL`s collapse to the same `url:` key when their href urls match.
 * - Plain {@link PdfSourceOptions} objects collapse to the same `json:` key when their JSON
 *   representations match (so fresh object literals across renders compare equal).
 * - Typed arrays and `ArrayBuffer`s (standalone or embedded inside a {@link PdfSourceOptions}) get a
 *   per-reference `ref:` key — different references are considered different sources even if their
 *   bytes match.
 *
 * The returned key is suitable for `===` comparison and for use as a lit `repeat` key prefix.
 *
 * @category Internal
 */
export function toPdfSourceKey(source: PdfSource): string {
    if (typeof source === 'string') {
        return `url:${source}`;
    } else if (source instanceof URL) {
        return `url:${source.href}`;
    } else if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
        return getOrCreateRefKey(source);
    }

    try {
        /*
         * The replacer swaps typed arrays / `ArrayBuffer`s out for stable reference keys so
         * structural comparison stays cheap for plain `PdfSourceOptions` fields while preserving
         * reference semantics for embedded PDF binary data (meaningful by identity, not by shape).
         * `safeJsonStringify` mirrors `JSON.stringify` at runtime but its declared parameters pick
         * only the array-filter overload, so cast to the full signature.
         */
        return `json:${(safeJsonStringify as typeof JSON.stringify)(
            sortObject(source),
            (_key: string, value: unknown) => {
                if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
                    return getOrCreateRefKey(value);
                } else if (value instanceof URL) {
                    return value.href;
                } else {
                    return value;
                }
            },
        )}`;
    } catch {
        /**
         * `JSON.stringify` can throw on circular references or BigInt values. Fall back to
         * reference equality so callers can still get a stable key by holding the same instance.
         */
        return getOrCreateRefKey(source);
    }
}
