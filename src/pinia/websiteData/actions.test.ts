import { toRef } from 'vue';
import { withStoreRegistry } from '@/pinia/testRegistry.test-support';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import _ from 'lodash-es';

vi.mock('@/_common/helpers/component/component.js', () => ({
    getComponentConfiguration: vi.fn(() => ({})),
    getComponentBaseConfiguration: vi.fn(() => ({ properties: {} })),
}));

import { createContentAndObjectsFromTemplate } from './commands';
import { useWebsiteDataState } from './state';

describe('createContentAndObjectsFromTemplate', () => {
    beforeEach(() => {
        const generatedUids: string[] = ['new-child', 'new-root'];

        vi.stubGlobal(
            'wwLib',
            withStoreRegistry({
                wwComponents: { load: vi.fn() },
                wwUtils: {
                    getUid: vi.fn(() => generatedUids.shift()),
                    isValidUuid: vi.fn(() => false),
                },
            })
        );
        vi.stubGlobal('_', _);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('creates full inline objects from the saved snapshot instead of the live store object', async () => {
        const state = {
            wwObjects: {
                'source-root': {
                    uid: 'source-root',
                    content: { default: { label: 'Live source changed after save' } },
                    _state: {},
                },
            },
        };
        const template = {
            uid: 'source-root',
            isWwObject: true,
            content: {
                default: {
                    label: 'Saved snapshot',
                    children: [
                        {
                            uid: 'source-child',
                            isWwObject: true,
                            content: { default: { label: 'Saved child' } },
                            _state: {
                                style: {
                                    '_wwParent_source-root_hover': { opacity: 0 },
                                },
                            },
                        },
                    ],
                },
            },
            _state: { states: [{ id: 'hover', isAppliedToChildren: true }] },
        };

        const { content, wwObjects } = await createContentAndObjectsFromTemplate({
            template,
            wwObjectsById: toRef(state, 'wwObjects'),
        });

        expect(content).toEqual({ isWwObject: true, uid: 'new-root' });
        expect(wwObjects['new-root'].content.default.label).toBe('Saved snapshot');
        expect(wwObjects['new-child'].content.default.label).toBe('Saved child');
        expect(wwObjects['new-child']._state.style).toEqual({
            '_wwParent_new-root_hover': { opacity: 0 },
        });
    });

    it('does not register a full inline template under its source uid', async () => {
        const state = { wwObjects: {} };
        const template = {
            uid: 'source-root',
            isWwObject: true,
            content: { default: { label: 'Saved snapshot' } },
            _state: {},
        };

        await createContentAndObjectsFromTemplate({ template, wwObjectsById: toRef(state, 'wwObjects') });

        expect(state.wwObjects).toEqual({});
    });

    it('still resolves uid-only object references from the live store', async () => {
        const state = {
            wwObjects: {
                'source-root': {
                    uid: 'source-root',
                    content: { default: { label: 'Live source' } },
                    _state: {},
                },
            },
        };

        const { content, wwObjects } = await createContentAndObjectsFromTemplate({
            template: { uid: 'source-root', isWwObject: true },
            wwObjectsById: toRef(state, 'wwObjects'),
        });

        expect(content).toEqual({ isWwObject: true, uid: 'new-child' });
        expect(wwObjects['new-child'].content.default.label).toBe('Live source');
    });

    it('follows a replaced object registry after awaiting component configuration', async () => {
        const wwObjectsById = useWebsiteDataState().wwObjects;
        wwObjectsById.value = {
            child: { uid: 'child', content: { default: { label: 'Before' } }, _state: {} },
        };
        let release: () => void;
        const loading = new Promise<void>(resolve => {
            release = resolve;
        });
        vi.mocked(wwLib.wwComponents.load).mockReturnValueOnce(loading);
        const pending = createContentAndObjectsFromTemplate({
            template: {
                uid: 'root',
                wwObjectBaseId: 'base',
                content: { default: { child: { uid: 'child', isWwObject: true } } },
                _state: {},
            },
            wwObjectsById,
            isFullObject: true,
        });
        wwObjectsById.value = {
            child: { uid: 'child', content: { default: { label: 'After' } }, _state: {} },
        };
        release();
        const { wwObjects } = await pending;
        expect(wwObjects['new-child'].content.default.label).toBe('After');
    });
});
