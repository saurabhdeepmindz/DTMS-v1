import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useWebsiteDataStore } from './index';
import { onEditorStateEvent } from '../editor/stateEvents';
import wwEditorHistory from '@/wwLib/servicesManager/wwEditorHistory.js';

beforeEach(() => {
    setActivePinia(createPinia());
    wwLib.wwEditorHistory = wwEditorHistory;
});
afterEach(() => vi.restoreAllMocks());

it('flushes pending edits before native Undo and emits the already-restored state', async () => {
    const pinia = createPinia();
    const store = useWebsiteDataStore(pinia);
    store.setWwObject({ uid: 'element', content: { default: { label: 'After' } } });
    const saved: string[] = [];
    onEditorStateEvent(event => {
        if (event.type === 'websiteData/sendHistory')
            saved.push(store.wwObjects.element.content.default.label as string);
    });
    const flush = vi.spyOn(wwEditorHistory, 'flushPendingHistory').mockImplementation(async () => {
        await Promise.resolve();
        store.history.undo.push({
            actions: [
                {
                    type: wwEditorHistory.TYPES.WWOBJECT,
                    uid: 'element',
                    oldData: { uid: 'element', content: { default: { label: 'Before' } } },
                    newData: { uid: 'element', content: { default: { label: 'After' } } },
                },
            ],
        });
    });
    await store.undo();
    expect(flush).toHaveBeenCalledOnce();
    expect(store.wwObjects.element.content.default.label).toBe('Before');
    await store.redo();
    expect(saved).toEqual(['Before', 'After']);
});
