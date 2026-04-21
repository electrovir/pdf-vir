/* eslint-disable @virmator/prefer-parse-url */

import {describe, itCases} from '@augment-vir/test';
import {arePdfSourcesEqual} from './pdf-vir.element.js';

describe(arePdfSourcesEqual.name, () => {
    const sharedBuffer = new Uint8Array([
        1,
        2,
        3,
    ]);
    const sharedInitParams = {
        url: '/shared.pdf',
    };

    itCases(arePdfSourcesEqual, [
        {
            it: 'returns true when both are undefined',
            inputs: [
                undefined,
                undefined,
            ],
            expect: true,
        },
        {
            it: 'returns false when only the first is undefined',
            inputs: [
                undefined,
                '/a.pdf',
            ],
            expect: false,
        },
        {
            it: 'returns false when only the second is undefined',
            inputs: [
                '/a.pdf',
                undefined,
            ],
            expect: false,
        },
        {
            it: 'matches identical strings',
            inputs: [
                '/a.pdf',
                '/a.pdf',
            ],
            expect: true,
        },
        {
            it: 'rejects different strings',
            inputs: [
                '/a.pdf',
                '/b.pdf',
            ],
            expect: false,
        },
        {
            it: 'matches distinct URL instances with the same href',
            inputs: [
                new URL('https://example.com/a.pdf'),
                new URL('https://example.com/a.pdf'),
            ],
            expect: true,
        },
        {
            it: 'rejects URLs with different urls',
            inputs: [
                new URL('https://example.com/a.pdf'),
                new URL('https://example.com/b.pdf'),
            ],
            expect: false,
        },
        {
            it: 'matches a string and a URL with the same href',
            inputs: [
                'https://example.com/a.pdf',
                new URL('https://example.com/a.pdf'),
            ],
            expect: true,
        },
        {
            it: 'matches a URL and a string with the same href',
            inputs: [
                new URL('https://example.com/a.pdf'),
                'https://example.com/a.pdf',
            ],
            expect: true,
        },
        {
            it: 'rejects a string and a URL with different urls',
            inputs: [
                '/a.pdf',
                new URL('https://example.com/a.pdf'),
            ],
            expect: false,
        },
        {
            it: 'matches the same typed-array instance',
            inputs: [
                sharedBuffer,
                sharedBuffer,
            ],
            expect: true,
        },
        {
            it: 'rejects distinct typed-array instances with identical bytes',
            inputs: [
                new Uint8Array([
                    1,
                    2,
                    3,
                ]),
                new Uint8Array([
                    1,
                    2,
                    3,
                ]),
            ],
            expect: false,
        },
        {
            it: 'matches the same ArrayBuffer instance',
            inputs: [
                sharedBuffer.buffer,
                sharedBuffer.buffer,
            ],
            expect: true,
        },
        {
            it: 'rejects distinct ArrayBuffer instances',
            inputs: [
                new ArrayBuffer(4),
                new ArrayBuffer(4),
            ],
            expect: false,
        },
        {
            it: 'matches the same DocumentInitParameters reference',
            inputs: [
                sharedInitParams,
                sharedInitParams,
            ],
            expect: true,
        },
        {
            it: 'rejects distinct DocumentInitParameters objects with equal fields',
            inputs: [
                {
                    url: '/shared.pdf',
                },
                {
                    url: '/shared.pdf',
                },
            ],
            expect: false,
        },
    ]);
});
