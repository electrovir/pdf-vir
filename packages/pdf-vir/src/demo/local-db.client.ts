import {LocalDbClient} from 'local-db-client';
import {defineShape, enumShape, recordShape} from 'object-shape-tester';
import {ViraThemeSelection} from 'vira';
import {pdfFormAssigneeShape} from '../pdf-form-assignee.js';
import {pdfFormFieldShape} from '../pdf-form-field.js';
import {pdfFormValuesShape} from '../pdf-form-value.js';

export async function createDemoLocalDbClient() {
    return await LocalDbClient.createClient(
        {
            /** Form editor fields, keyed by the PDF source they were placed on. */
            formFields: {
                shape: defineShape(
                    recordShape({
                        keys: '',
                        values: [pdfFormFieldShape],
                        partial: true,
                    }),
                ),
            },
            /** Form filler values, keyed by the PDF source they were filled out on. */
            formValues: {
                shape: defineShape(
                    recordShape({
                        keys: '',
                        values: pdfFormValuesShape,
                        partial: true,
                    }),
                ),
            },
            /** Who form editor fields can be assigned to, shared by every PDF. */
            assignees: {
                shape: defineShape([pdfFormAssigneeShape]),
            },
            /** The name the form filler stamps into signature and initials fields. */
            adoptedSignerName: {
                shape: defineShape(''),
            },
            /** The theme picked in the demo's theme switcher. */
            selectedTheme: {
                shape: defineShape(enumShape(ViraThemeSelection)),
            },
        },
        {
            storeName: 'pdf-vir-demo',
        },
    );
}

export type DemoLocalDbClient = Awaited<ReturnType<typeof createDemoLocalDbClient>>;
