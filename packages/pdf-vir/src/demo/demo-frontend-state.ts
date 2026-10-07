/// <reference types="vite/client" />

import {check} from '@augment-vir/assert';
import {removePrefix, removeSuffix} from '@augment-vir/common';
import {Observable} from 'element-vir';
import {SpaRouter} from 'spa-router-vir';
import {DemoThemeClient} from './demo-theme.client.js';
import {createDemoLocalDbClient} from './local-db.client.js';

export enum DemoMode {
    Viewer = 'viewer',
    FormEditor = 'form-editor',
    FormFiller = 'form-filler',
}

export const demoRouter = new SpaRouter<[DemoMode], undefined, undefined>({
    /**
     * Vite's base is `/` while developing and `/<repo-name>/` for the GitHub Pages build, but the
     * router wants the bare segment with no slashes.
     */
    basePath: removeSuffix({
        value: removePrefix({
            value: import.meta.env.BASE_URL,
            prefix: '/',
        }),
        suffix: '/',
    }),
    sanitizeRoute(rawRoute) {
        return {
            paths: [
                check.isEnumValue(rawRoute.paths[0], DemoMode)
                    ? rawRoute.paths[0]
                    : DemoMode.Viewer,
            ],
            search: undefined,
            hash: undefined,
        };
    },
});

/** Everything the demo page shares: persistence, theming, and the current route. */
export async function createDemoFrontendState() {
    const localDbClient = await createDemoLocalDbClient();
    const themeClient = new DemoThemeClient(localDbClient);

    const frontendState = new Observable({
        /** The default deep equality check crashes on the clients' symbol-keyed internals. */
        equalityCheck: check.strictEquals,
        defaultValue: {
            localDbClient,
            themeClient,
            currentRoute: demoRouter.readCurrentRoute(),
        },
    });

    const removeRouteListener = demoRouter.listen(false, (currentRoute) => {
        frontendState.setValue({
            ...frontendState.value,
            currentRoute,
        });
    });

    return Object.assign(frontendState, {
        destroy() {
            removeRouteListener();
            themeClient.destroy();
            Observable.prototype.destroy.call(frontendState);
        },
    });
}

export type DemoFrontendState = Awaited<ReturnType<typeof createDemoFrontendState>>;
