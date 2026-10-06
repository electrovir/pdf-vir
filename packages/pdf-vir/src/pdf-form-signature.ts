import {collapseWhiteSpace} from '@augment-vir/common';

/**
 * Normalizes a typed name into the text stamped into a signature field: trimmed, with runs of
 * whitespace collapsed to one space.
 *
 * @category Internal
 * @example
 *
 * ```ts
 * import {normalizeSignerName} from 'pdf-vir';
 *
 * normalizeSignerName(' jane  q doe '); // 'jane q doe'
 * ```
 */
export function normalizeSignerName(signerName: string) {
    return collapseWhiteSpace(signerName);
}

/**
 * Derives the text stamped into an initials field from a typed name: the first letter of each word,
 * upper cased. Characters before a word's first letter are skipped and words without letters are
 * dropped. A name with no letters at all falls back to the first character of each word.
 *
 * @category Internal
 * @example
 *
 * ```ts
 * import {getSignerInitials} from 'pdf-vir';
 *
 * getSignerInitials(' jane  q doe '); // 'JQD'
 * getSignerInitials('(jane) doe'); // 'JD'
 * getSignerInitials('123 456'); // '14'
 * ```
 */
export function getSignerInitials(signerName: string) {
    const words = normalizeSignerName(signerName).split(' ');
    const letterInitials = words
        .map((word) => word.match(/\p{L}/u)?.[0]?.toUpperCase() ?? '')
        .join('');

    return letterInitials || words.map((word) => word.charAt(0).toUpperCase()).join('');
}
