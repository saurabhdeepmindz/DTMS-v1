import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia } from 'pinia';
import { computed } from 'vue';
import { createElementClassName } from '@/_common/helpers/styleCompiler';
import { useWebsiteDataState } from './websiteData/state';
// @ts-expect-error Vitest strips editor blocks through wewebTargetBlockPlugin.
import { useWebsiteDataWriters } from './websiteData/writers.ts?ww-target=front';
// @ts-expect-error Vitest strips editor blocks through wewebTargetBlockPlugin.
import { useWebsiteDataCommands } from './websiteData/commands.ts?ww-target=front';
// @ts-expect-error Vitest strips editor blocks through wewebTargetBlockPlugin.
import { usePopupStore } from './popup.js?ww-target=front';

describe('published popups', () => {
    let popups: ReturnType<typeof usePopupStore>;
    let state: ReturnType<typeof useWebsiteDataState>;
    let writers: ReturnType<typeof useWebsiteDataWriters>;
    let popupConfiguration: { isStacked?: boolean };

    beforeEach(async () => {
        state = useWebsiteDataState();
        popupConfiguration = {};
        writers = useWebsiteDataWriters({ stateRefs: state });
        const websiteData = useWebsiteDataCommands({
            stateRefs: state,
            getters: { designInfo: computed(() => ({})), pluginsById: computed(() => ({})) },
            writers,
        });
        vi.stubGlobal('wwLib', {
            store: {
                websiteData,
                libraries: { components: { modal: { configuration: { popup: popupConfiguration } } } },
            },
        });
        await websiteData.setFullDesign({ runtimeStyleIdStart: 100, pages: [], plugins: [] });
        popups = usePopupStore(createPinia());
    });

    it('opens a popup and lets its workflow continue after editor code is stripped', async () => {
        const content = { message: 'Published popup' };
        const uid = await popups.open('modal', content);

        expect(popups.instances[uid]).toMatchObject({ uid, libraryComponentBaseId: 'modal', content });
        expect(popups.instances[uid]._si).toBeTypeOf('number');
        expect(state.styleSourceIdRegistry.value.idByUid.get(uid)).toBe(popups.instances[uid]._si);
    });

    it('exposes only defined commands after editor-only writers are stripped', () => {
        expect(Object.keys(wwLib.store.websiteData)).not.toHaveLength(0);
        for (const [name, command] of Object.entries(wwLib.store.websiteData)) {
            expect(command, name).toBeTypeOf('function');
        }
    });

    it('waits for closing and returns the close result to every waiter', async () => {
        const first = popups.open('modal', {}, { waitClosing: true });
        const uid = Object.keys(popups.instances)[0];
        const second = popups.open('modal', {}, { waitClosing: true });

        expect(Object.keys(popups.instances)).toEqual([uid]);
        popups.close(uid, { confirmed: true });

        await expect(first).resolves.toEqual({ confirmed: true });
        await expect(second).resolves.toEqual({ confirmed: true });
        expect(popups.instances).toEqual({});
    });

    it('reuses a non-stacked popup and assigns a fresh identity when reopened', async () => {
        const first = await popups.open('modal', null);
        const styleId = popups.instances[first]._si;
        expect(await popups.open('modal', null)).toBe(first);
        popups.close(first);
        const reopened = await popups.open('modal', null);

        expect(reopened).not.toBe(first);
        expect(popups.instances[reopened]._si).not.toBe(styleId);
    });

    it('keeps popup identities distinct from loaded page sources and stacked instances', async () => {
        const source = { uid: 'page-source', _si: 12 };
        wwLib.store.websiteData.ensureStyleSourceIds([source]);
        popupConfiguration.isStacked = true;

        const first = await popups.open('modal', {});
        const second = await popups.open('modal', {});

        expect(new Set([source._si, popups.instances[first]._si, popups.instances[second]._si]).size).toBe(3);
        popups.closeAll('modal');
        expect(popups.instances).toEqual({});
    });

    it('reserves the complete published range even when its sources are not loaded', async () => {
        const source = { uid: 'page-source', _si: 12 };
        wwLib.store.websiteData.ensureStyleSourceIds([source]);
        const publishedClasses = new Set(Array.from({ length: 100 }, (_, id) => createElementClassName('saved', id)));

        for (let open = 0; open < 10; open++) {
            const uid = await popups.open('modal', {});
            const instance = popups.instances[uid];
            expect(instance._si).toBeGreaterThanOrEqual(100);
            expect(publishedClasses.has(createElementClassName(uid, instance._si))).toBe(false);
            popups.close(uid);
        }
        expect(source._si).toBe(12);
    });

    it('keeps runtime ids increasing when a later page loads persisted ids', async () => {
        const first = await popups.open('modal', {});
        const firstId = popups.instances[first]._si;
        popups.close(first);
        const nextPageSource = { uid: 'other-page-source', _si: 99 };
        writers.setPageData({ page: { id: 'next' }, sections: {}, wwObjects: { nextPageSource } });
        const reopened = await popups.open('modal', {});

        expect(nextPageSource._si).toBe(99);
        expect(popups.instances[reopened]._si).toBeGreaterThan(firstId);
        expect(firstId).toBeGreaterThanOrEqual(100);
    });

    it.each([undefined, null, -1, 1.5, '100', Number.NaN, Number.POSITIVE_INFINITY])(
        'uses UID style identities for publications without a valid boundary (%s)',
        async boundary => {
            Object.assign(state.design.value.info, { runtimeStyleIdStart: boundary });
            const registrySize = state.styleSourceIdRegistry.value.idByUid.size;
            popupConfiguration.isStacked = true;
            const first = await popups.open('modal', {});
            const second = await popups.open('modal', {});

            expect(popups.instances[first]._si).toBeUndefined();
            expect(popups.instances[second]._si).toBeUndefined();
            expect(createElementClassName(first)).not.toBe(createElementClassName(second));
            expect(createElementClassName(first)).not.toMatch(/^ww-e-d/);
            expect(state.styleSourceIdRegistry.value.idByUid.size).toBe(registrySize);
        }
    );

    it('accepts zero as the boundary of an empty published project', async () => {
        state.design.value.info = { runtimeStyleIdStart: 0 };
        const uid = await popups.open('modal', {});
        expect(popups.instances[uid]._si).toBe(0);
    });

    it('keeps close results and deduplication working for older publications', async () => {
        state.design.value.info = {};
        const first = popups.open('modal', {}, { waitClosing: true });
        const uid = Object.keys(popups.instances)[0];
        const second = popups.open('modal', {}, { waitClosing: true });
        expect(Object.keys(popups.instances)).toEqual([uid]);
        expect(popups.instances[uid]._si).toBeUndefined();
        popups.close(uid, { confirmed: true });
        await expect(first).resolves.toEqual({ confirmed: true });
        await expect(second).resolves.toEqual({ confirmed: true });
    });

    it('falls back to a UID before the numeric runtime range is exhausted', async () => {
        state.design.value.info = { runtimeStyleIdStart: Number.MAX_SAFE_INTEGER - 1 };
        const first = await popups.open('modal', {});
        expect(popups.instances[first]._si).toBe(Number.MAX_SAFE_INTEGER - 1);
        popups.close(first);
        const second = await popups.open('modal', {});
        expect(popups.instances[second]._si).toBeUndefined();
    });
});
