import { cloneDeep } from 'lodash-es';
import type { ComponentDefinition, DataRecord, Page } from '../entities';
import type { WebsiteDataState } from './state';

type ObjectState = Pick<WebsiteDataState, 'wwObjects'>;

/** Expand stored object references into snapshots, optionally removing instance IDs for templates. */
function parseFullObject(state: ObjectState, data: unknown, asTemplate = false): unknown {
    if (!data || typeof data !== 'object') return data;
    if (Array.isArray(data)) return data.map(child => parseFullObject(state, child, asTemplate));

    const record = data as DataRecord;
    if (record.isWwObject && (typeof record.uid === 'string' || typeof record.uid === 'number') && record.uid) {
        const wwObject = state.wwObjects[record.uid];
        if (!wwObject) return {};
        const result: Partial<ComponentDefinition> = {
            ...wwObject,
            content: parseFullObject(state, wwObject.content, asTemplate) as ComponentDefinition['content'],
            _state: parseFullObject(state, wwObject._state, asTemplate) as ComponentDefinition['_state'],
        };
        if (asTemplate) {
            result.isWwObject = true;
            delete result.uid;
        }
        return result;
    }
    const result: DataRecord = {};
    for (const key of Object.keys(record)) result[key] = parseFullObject(state, record[key], asTemplate);
    return result;
}

export default {
    getFullPage(state: Pick<WebsiteDataState, 'design' | 'pageId' | 'sections' | 'wwObjects'>): Page | null {
        let fullPage: Page | null = null;
        for (const page of state.design.pages) {
            if (page.id == state.pageId) {
                fullPage = cloneDeep(page);
                for (const i in fullPage.sections) {
                    fullPage.sections[i] = cloneDeep(state.sections[fullPage.sections[i].uid]);
                }
                fullPage = parseFullObject(state, fullPage) as Page;
            }
        }
        return fullPage;
    },
    parseFullObject,
};
