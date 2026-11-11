import { createStoreRegistry } from '@/pinia/storeRegistry';
import { describe, expect, it } from 'vitest';

import { createPinia } from 'pinia';
import { useWebsiteDataStore } from './index';

describe('websiteData state mutations', () => {
    it('removes exact class and subclass mappings when deleting a state', () => {
        const pinia = createPinia();
        const store = useWebsiteDataStore(pinia);
        const mutations = createStoreRegistry(pinia).websiteData.writers;
        store.$patch({
            wwObjects: {
                element: {
                    _state: {
                        states: [{ id: '_wwHover', label: 'Hover' }],
                        style: { _wwHover_default: { opacity: 0.5 } },
                        classes: {
                            default: ['baseClass'],
                            _wwHover: ['hoverClass'],
                            _wwHover_legacy: ['legacyHoverClass'],
                        },
                        subClasses: {
                            default: { baseClass: ['baseSubClass'] },
                            _wwHover: { hoverClass: ['hoverSubClass'] },
                        },
                    },
                    content: { _wwHover_default: { text: 'Hover' } },
                },
            },
            sections: {},
        });
        const state = store.$state;

        mutations.deleteComponentState({
            type: 'element',
            uid: 'element',
            stateId: '_wwHover',
        });
        mutations.addComponentState({
            type: 'element',
            uid: 'element',
            state: { id: '_wwHover', label: 'Hover' },
        });

        expect(state.wwObjects.element._state.classes).toEqual({ default: ['baseClass'] });
        expect(state.wwObjects.element._state.subClasses).toEqual({
            default: { baseClass: ['baseSubClass'] },
        });
        expect(state.wwObjects.element._state.style).toEqual({});
        expect(state.wwObjects.element.content).toEqual({});
    });
});
