import {ViraThemeClient, ViraThemeSelection} from 'vira';
import {type DemoLocalDbClient} from './local-db.client.js';

/**
 * A `ViraThemeClient` that saves the selected theme in the demo's local DB instead of Vira's own
 * LocalStorage entry.
 */
export class DemoThemeClient extends ViraThemeClient {
    /**
     * `ViraThemeClient`'s constructor reads the current theme before this class's constructor can
     * set this, so it starts out undefined.
     */
    protected selectedTheme: ViraThemeSelection | undefined;

    constructor(protected readonly localDbClient: DemoLocalDbClient) {
        super();
        this.selectedTheme = localDbClient.value.selectedTheme;
        this.applySelection(this.getCurrentTheme());
    }

    public override getCurrentTheme() {
        return this.selectedTheme || ViraThemeSelection.Auto;
    }

    public override setSelectedTheme(selection: ViraThemeSelection) {
        this.selectedTheme = selection;
        this.applySelection(selection);
        void this.localDbClient.set.selectedTheme(selection);
    }
}
