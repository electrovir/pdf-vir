import {describe, itCases} from '@augment-vir/test';
import {getSignerInitials, normalizeSignerName} from './pdf-form-signature.js';

describe(normalizeSignerName.name, () => {
    itCases(normalizeSignerName, [
        {
            it: 'collapses whitespace',
            input: ' jane  q doe ',
            expect: 'jane q doe',
        },
        {
            it: 'handles a blank name',
            input: '   ',
            expect: '',
        },
    ]);
});

describe(getSignerInitials.name, () => {
    itCases(getSignerInitials, [
        {
            it: 'capitalizes the first letter of each word',
            input: ' jane  q doe ',
            expect: 'JQD',
        },
        {
            it: 'skips characters before the first letter of a word',
            input: '(jane) doe',
            expect: 'JD',
        },
        {
            it: 'drops words without letters',
            input: 'jane 😀 doe',
            expect: 'JD',
        },
        {
            it: 'keeps non-Latin letters',
            input: 'éva øst',
            expect: 'ÉØ',
        },
        {
            it: 'falls back to the first character of each word when there are no letters',
            input: '123 456',
            expect: '14',
        },
        {
            it: 'handles a blank name',
            input: '   ',
            expect: '',
        },
    ]);
});
