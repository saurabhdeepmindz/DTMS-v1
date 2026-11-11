import { createTestCompatibilityStore, disposeTestRuntime, withStoreRegistry } from './testRegistry.test-support';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, watchEffect } from 'vue';
import { useManagerStore } from './manager';
import { useFrontStore } from './front';

beforeEach(() => vi.stubGlobal('localStorage', { setItem: vi.fn() }));

describe('single runtime native store registry', () => {
    it('creates no stores until accessed and shares native instances with the compatibility facade', () => {
        const runtime = withStoreRegistry({});
        const { store: registry, $pinia: pinia } = runtime;
        expect(wwLib.store).toBe(registry);
        expect(Object.keys(pinia.state.value)).toEqual([]);
        expect(Object.isFrozen(registry)).toBe(true);
        expect(registry.front).toBe(useFrontStore(pinia));
        expect(Object.keys(pinia.state.value)).toEqual(['front']);
        const compatibility = createTestCompatibilityStore(pinia);
        expect(compatibility.state.front).toBe(registry.front.$state);
        expect(registry.manager).toBe(useManagerStore(pinia));
    });

    it('keeps state replacement reactive and invalidates only readers of the changed object', async () => {
        const registry = withStoreRegistry({}).store;
        registry.websiteData.setWwObject({ uid: 'a', name: 'A' });
        registry.websiteData.setWwObject({ uid: 'b', name: 'B' });
        const readsA = vi.fn(),
            readsB = vi.fn();
        const scope = effectScope();
        scope.run(() => {
            watchEffect(() => readsA(registry.websiteData.wwObjects.a.name));
            watchEffect(() => readsB(registry.websiteData.wwObjects.b.name));
        });
        registry.websiteData.setWwObject({ uid: 'a', name: 'Updated' });
        await nextTick();
        expect(readsA).toHaveBeenLastCalledWith('Updated');
        expect(readsA).toHaveBeenCalledTimes(2);
        expect(readsB).toHaveBeenCalledTimes(1);
        registry.websiteData.wwObjects = { a: { uid: 'a', name: 'Replacement' }, b: { uid: 'b', name: 'B' } };
        await nextTick();
        expect(readsA).toHaveBeenLastCalledWith('Replacement');
        scope.stop();
    });

    it('keeps collection references and independently updates their totals', () => {
        const registry = withStoreRegistry({}).store;
        registry.data.setCollection({ id: 'collection', data: [{ id: 1 }], total: 250 });
        const collection = registry.data.collections.collection,
            rows = collection.data;
        registry.front.setLang('fr');
        registry.data.setCollection({ id: 'collection', total: 251 });
        expect(registry.front.lang).toBe('fr');
        expect(registry.data.collections.collection).toBe(collection);
        expect(collection.data).toBe(rows);
        expect(collection.total).toBe(251);
    });

    it('shares the installed registry between editor consumers and starts fresh after runtime disposal', () => {
        const first = withStoreRegistry({}).store;
        const frame = wwLib.store;
        expect(frame).toBe(first);
        first.front.setLang('fr');
        first.data.setFormula({ id: 'formula', name: 'Previous runtime' });
        disposeTestRuntime();
        const next = withStoreRegistry({}).store;
        expect(next === first).toBe(false);
        expect(next.data.formulas.formula).toBeUndefined();
        expect(next.front.lang).not.toBe('fr');
    });
});
