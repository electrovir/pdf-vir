import {describe, itCases} from '@augment-vir/test';
import {ViraThemeColorName} from 'vira';
import {pickNewPdfFormAssigneeColor} from './pdf-form-assignee.js';

describe(pickNewPdfFormAssigneeColor.name, () => {
    itCases(pickNewPdfFormAssigneeColor, [
        {
            it: 'skips colors already picked by position',
            input: [
                {
                    id: 'signer-1',
                    label: 'Signer 1',
                },
            ],
            expect: ViraThemeColorName.purple,
        },
        {
            it: 'reuses a position color that a chosen color freed up',
            input: [
                {
                    id: 'signer-1',
                    label: 'Signer 1',
                    color: ViraThemeColorName.purple,
                },
            ],
            expect: ViraThemeColorName.blue,
        },
    ]);
});
