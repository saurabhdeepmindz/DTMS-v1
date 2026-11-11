import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import _ from 'lodash-es';
import history from '@/wwLib/servicesManager/wwEditorHistory.js';
import { withStoreRegistry } from '@/pinia/testRegistry.test-support';

vi.mock('@/pinia/variables.js', () => ({ useVariablesStore: vi.fn() }));
vi.mock('@/pinia/backTableViews.js', () => ({ useBackTableViewsStore: vi.fn() }));
vi.mock('@/pinia/backTableFormulaColumns.js', () => ({ useBackTableFormulaColumnsStore: vi.fn() }));
vi.mock('@/_common/helpers/component/component.js', () => ({
    getComponentConfiguration: vi.fn(),
    getComponentBaseConfiguration: vi.fn(),
}));

describe('atomic drop history through the actual store action', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('_', _);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('preserves separate owner and descendant-parent snapshots for two immediately consecutive drops', async () => {
        const reference = { isWwObject: true, uid: 'subject' };
        const owner = (section: string, children: Array<{ isWwObject: boolean; uid: string }> = []) => ({
            parentSectionId: section,
            parentLibraryComponentId: null,
            content: { default: { children } },
        });
        const wwObjects = {
            origin: owner('section-a', [reference]),
            middle: owner('section-b'),
            destination: owner('section-c'),
            subject: {
                ...owner('section-a'),
                content: { default: { child: { isWwObject: true, uid: 'descendant' } } },
            },
            descendant: owner('section-a'),
        };
        const saved: Array<{ actions: Array<{ type: string; oldData: unknown; newData: unknown; uids?: string[] }> }> =
            [];
        Object.assign(history, { adding: false, historiesToBeAdded: [], historyNb: 0, HISTORY_DELAY: 300 });
        const runtime = withStoreRegistry({
            wwEditorHistory: history,
            wwUtils: { getUid: () => `history-${saved.length}` },
            editorSelectionStore: { unselectAllComponents: vi.fn() },
        });
        for (const [uid, object] of Object.entries(wwObjects)) {
            runtime.store.websiteData.wwObjects[uid] = { uid, ...object };
        }
        vi.spyOn(runtime.store.websiteData, 'addHistory').mockImplementation(async entry => {
            saved.push(_.cloneDeep(entry));
        });
        const move = (from: 'origin' | 'middle', to: 'middle' | 'destination') =>
            runtime.store.websiteData.moveWwObjectBetweenLayouts({
                wwObjectId: 'subject',
                originElement: { wwObjectId: from, path: 'content.children', value: [] },
                targetElement: { wwObjectId: to, path: 'content.children', value: [reference] },
            });
        await move('origin', 'middle');
        await move('middle', 'destination');
        await history.flushPendingHistory();
        expect(saved).toHaveLength(2);
        expect(saved.map(entry => entry.actions.length)).toEqual([3, 3]);
        const parents = saved.map(entry => entry.actions.find(action => action.uids?.includes('subject'))!);
        expect(parents.map(action => action.oldData)).toEqual([
            { parentSectionId: 'section-a', parentLibraryComponentId: null },
            { parentSectionId: 'section-b', parentLibraryComponentId: null },
        ]);
        expect(parents.map(action => action.newData)).toEqual([
            { parentSectionId: 'section-b', parentLibraryComponentId: null },
            { parentSectionId: 'section-c', parentLibraryComponentId: null },
        ]);
        for (const action of parents) expect(action.uids).toEqual(['subject', 'descendant']);
        expect(runtime.store.websiteData.wwObjects.destination.content.default.children).toEqual([reference]);
        expect(runtime.store.websiteData.wwObjects.subject.parentSectionId).toBe('section-c');
        expect(runtime.store.websiteData.wwObjects.descendant.parentSectionId).toBe('section-c');
    });
});
