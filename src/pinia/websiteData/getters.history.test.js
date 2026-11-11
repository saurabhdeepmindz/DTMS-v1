import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/_manager/helpers/plugins.js', () => ({ PLUGIN_CATEGORIES: {} }));
vi.mock('@/_common/helpers/component/component.js', () => ({ getComponentLabel: (_type, uid) => uid }));
vi.mock('@/pinia/componentBases.js', () => ({ useComponentBasesStore: vi.fn() }));
vi.mock('@/pinia/variables.js', () => ({ useVariablesStore: vi.fn() }));
vi.mock('@/_manager/helpers/aiProtectedResources.js', () => ({ describeAiProtectedResource: vi.fn() }));

import { useWebsiteDataState } from './state';
import { useWebsiteDataGetters } from './getters';

const conversation = {
    id: 'conversation',
    chat: [
        { id: 'first-msg', role: 'user', content: 'Create a title' },
        { id: 'first-answer', role: 'assistant', content: '{"id":"item"}' },
        { id: 'second-msg', role: 'user', content: 'Put the text in uppercase' },
        // Stored by the AI server: no `id`, the message id is `<aiQueryId>-<index>`.
        { aiQueryMessageId: 'conversation-3', role: 'assistant', content: '{"id":"other-item"}' },
    ],
};

const aiEntry = (date, aiQueryMessageId) => ({
    display: { type: 'wwobject', action: 'update', uid: 'title' },
    realDate: date,
    aiQueryId: 'conversation',
    aiQueryMessageId,
});

describe('history labels of the AI changes', () => {
    beforeEach(() => {
        vi.stubGlobal('wwLib', {
            wwEditorHistory: {
                TYPES: { WWOBJECT: 'wwobject' },
                ACTIONS: { INITIAL: 'initial' },
                DIRECTIONS: { UNDO: 'undo', REDO: 'redo' },
            },
            store: { manager: { aiQueriesHistory: [conversation] } },
        });
    });

    it('shows the user message that triggered each change', () => {
        const state = { history: { undo: [aiEntry(1, 'first-msg'), aiEntry(2, 'second-msg')], redo: [] } };
        const labels = useWebsiteDataGetters(
            Object.assign(useWebsiteDataState(), { history: { value: state.history } })
        ).historyDetails.value.map(item => item.elementName);
        expect(labels).toEqual(['Put the text in uppercase', 'Create a title', '']);
    });

    it('shows the user message before the answer the AI server saved its change with', () => {
        const state = { history: { undo: [aiEntry(1, 'first-answer'), aiEntry(2, 'conversation-3')], redo: [] } };
        const labels = useWebsiteDataGetters(
            Object.assign(useWebsiteDataState(), { history: { value: state.history } })
        ).historyDetails.value.map(item => item.elementName);
        expect(labels).toEqual(['Put the text in uppercase', 'Create a title', '']);
    });

    it('keeps the default label when the message is gone', () => {
        const state = { history: { undo: [aiEntry(1, 'deleted-msg')], redo: [] } };
        expect(
            useWebsiteDataGetters(Object.assign(useWebsiteDataState(), { history: { value: state.history } }))
                .historyDetails.value[0].elementName
        ).toBe('element title');
    });
});
