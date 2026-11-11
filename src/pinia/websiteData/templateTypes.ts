import type { ComponentDefinition, Registry } from '../entities';
import type { WebsiteDataStateRefs } from './state';

export interface TemplateOptions<T> {
    template: T;
    wwObjectsById: WebsiteDataStateRefs['wwObjects'];
    wwObjects?: Registry<ComponentDefinition>;
    keepChildren?: boolean;
    isFullObject?: boolean;
    isRecursion?: boolean;
    isLinked?: boolean;
    keepUid?: boolean;
    uidsToReplace?: Array<{ old: string | number; new: string }>;
}
export interface TemplateResult<T> {
    content: T;
    wwObjects: Registry<ComponentDefinition>;
}
export interface ComponentTemplate {
    name?: string;
    content?: ComponentDefinition['content'];
    _state?: ComponentDefinition['_state'];
    wwObjectBaseId?: string;
    libraryComponentBaseId?: string;
    parentSectionId?: string;
    parentLibraryComponentId?: string;
    [key: string]: unknown;
    uid?: string | number;
    isWwObject?: boolean;
    type?: string;
}
