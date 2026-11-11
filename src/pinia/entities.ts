/** Persisted records can carry component/plugin-defined fields; those values stay opaque. */
export type DataRecord = Record<string, unknown>;
export type Registry<T> = Record<string, T>;
export type ComponentKind = 'element' | 'section' | 'libraryComponent';
export interface ContentProperties extends DataRecord {
    wwObjects?: DataRecord[];
    children?: DataRecord[] | { __wwtype: string; repeatable: DataRecord[] };
}
export type ResponsiveContent = Record<string, ContentProperties>;
export interface ComponentState {
    id: string;
    label?: string;
    [key: string]: unknown;
}
export interface ComponentDefinition {
    uid: string;
    name?: string;
    sectionTitle?: string;
    wwObjectBaseId?: string;
    sectionBaseId?: string;
    libraryComponentBaseId?: string;
    parentSectionId?: string;
    parentLibraryComponentId?: string;
    content?: ResponsiveContent;
    _state?: {
        states?: ComponentState[];
        style?: ResponsiveContent;
        classes?: Record<string, string[]>;
        subClasses?: Record<string, Record<string, string[]>>;
        interactions?: Workflow[];
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
export interface PageSection {
    uid: string;
    sectionTitle?: string;
    isLinked?: boolean;
}
export interface Page {
    id: string;
    linkId?: string;
    name?: string;
    icon?: string;
    sections?: PageSection[];
    workflows?: Workflow[];
    paths?: Record<string, string>;
    pageLoaded?: boolean;
    langs?: string[];
    pageUserGroups?: string[];
    security?: { accessRule?: string; [key: string]: unknown };
    cmsDataSetPath?: string;
    data?: unknown;
    [key: string]: unknown;
}
export interface DesignInfo {
    runtimeStyleIdStart?: number;
    id?: string;
    name?: string;
    homePageId?: string;
    defaultTheme?: string;
    defaultLang?: string;
     authPluginId?: string;
    langs?: Array<{ lang: string; default?: boolean }>;
    fonts?: unknown[];
    workflows?: Workflow[];
    deployConfig?: DataRecord;
    [key: string]: unknown;
}
export interface Design {
    info: DesignInfo | null;
    pages: Page[];
}
export interface PluginSettings {
    publicData?: DataRecord;
    privateData?: DataRecord;
    [key: string]: unknown;
}
export interface Plugin {
    id: string;
    name?: string;
    namespace?: string;
    isDev?: boolean;
    isLoaded?: boolean;
    settings?: PluginSettings;
    pluginCategoryId?: string;
    pluginCategory?: { id: string; name: string };
    icon?: string;
    repository?: string | DataRecord;
    markdown?: string;
    [key: string]: unknown;
}
export interface Collection {
    id: string;
    name?: string;
    type?: string;
    folder?: string;
    pluginId?: string;
    mode?: string;
    data?: DataRecord | unknown[] | null;
    total?: number;
    offset?: number;
    limit?: unknown;
    fields?: DataRecord;
    isFetching?: boolean;
    isFetched?: boolean;
    config?: { isPersistentOnNav?: boolean; [key: string]: unknown };
    [key: string]: unknown;
}
export interface Formula {
    id: string;
    name?: string;
    folder?: string;
    code?: string;
    parameters?: unknown[];
    [key: string]: unknown;
}
export interface Workflow {
    id: string;
    meta?: {
        jobs?: { crons?: Array<{ id: string; name?: string; [key: string]: unknown }>; [key: string]: unknown };
        [key: string]: unknown;
    };
    name?: string;
    folder?: string;
    type?: string;
    trigger?: string;
    parameters?: unknown[];
    version?: number;
    actions?: Registry<{ id: string; [key: string]: unknown }>;
    [key: string]: unknown;
}
export interface PageParameterVariable {
    id: string;
    name?: string;
    type?: string;
    value?: unknown;
    defaultValue?: unknown;
    pageId?: string;
    queryName?: string;
}
export interface PluginTrigger {
    value: string;
    pluginId: string;
    [key: string]: unknown;
}
export interface WorkflowActionResult {
    result?: unknown;
    error?: unknown;
    config?: unknown;
    loop?: unknown;
    stream?: unknown;
}
export interface WorkflowResults {
    variables?: Registry<{ value: unknown; type?: string; scopeId?: string }>;
    error?: unknown;
    __metadata?: unknown;
    [key: string]: unknown;
}
export interface LibraryItem {
    id: string;
    libraryId?: string;
    name?: string;
    [key: string]: unknown;
}
export interface LibraryComponent extends LibraryItem {
    rootElementId?: string;
    inner?: { root?: string; variables?: Registry<DataRecord>; workflows?: Registry<Workflow>; [key: string]: unknown };
}
export interface Library {
    id?: string;
    name?: string;
    versionId?: string;
    latestVersionId?: string;
    version?: number;
    updatedAt?: string;
    latestVersionAt?: string;
    guidelines?: unknown;
    plugins?: Plugin[];
    libraries?: Library[];
    sections?: LibraryItem[];
    elements?: LibraryItem[];
    styles?: LibraryItem[];
    classes?: LibraryItem[];
    components?: LibraryComponent[];
    componentsElements?: ComponentDefinition[];
    [key: string]: unknown;
}
export interface EditorUser {
    id?: string;
    socketId?: string;
    role?: string;
    admin?: boolean;
    beta?: boolean;
    hidden?: boolean;
    isMcp?: boolean;
    color?: string;
    objectSelected?: string;
    pageId?: string;
    pos?: { x: number; y: number };
    screen?: unknown;
    /** What the user may do on the project (`accessPermissions`), as the server sends them: none sent restricts nothing. */
    permissions?: string[];
    /** What the user may do across the project's workspace (`billing`, `all`…). */
    workspacePermissions?: string[];
    [key: string]: unknown;
}
export interface PopupSidebar {
    name: string;
    options: { closed?: boolean; position?: string; data?: unknown; [key: string]: unknown };
    [key: string]: unknown;
}
export interface HistoryAction {
    date?: number;
    type: string;
    action?: string;
    uid?: string;
    uids?: string[];
    oldData?: unknown;
    newData?: unknown;
    [key: string]: unknown;
}
export interface HistoryItem {
    actions: HistoryAction[];
    display?: {
        type?: string;
        action?: string;
        subAction?: string;
        uid?: string;
        name?: string;
        oldUid?: string;
        instancesCount?: number;
        [key: string]: unknown;
    };
    realDate?: Date | string | number;
    aiQueryId?: string;
    aiQueryMessageId?: string;
    noHistory?: boolean;
    [key: string]: unknown;
}
export interface HistoryCommand {
    historyItem: HistoryItem;
    direction: 'undo' | 'redo';
}
export interface ComponentPropertyUpdate {
    type: ComponentKind;
    uid: string;
    path: string;
    value: unknown;
    media?: string;
    updateElementParent?: unknown;
}
export interface PageData {
    page: Page;
    sections: Registry<ComponentDefinition>;
    wwObjects: Registry<ComponentDefinition>;
}
export interface FullDesign extends DesignInfo {
    pages: Page[];
    plugins?: Plugin[];
}
export interface LayoutOwner {
    wwObjectId?: string;
    sectionId?: string;
    path: string;
    value: unknown;
}
export interface HistoryDetail {
    action?: string;
    actionLabel?: string;
    elementName?: string;
    elementType?: string;
    elementId?: string;
    date?: Date | string | number;
    index?: number;
    dir?: string;
    active?: boolean;
    aiQueryId?: string;
    aiQueryMessageId?: string;
}
export interface PluginConfiguration {
    name: string;
    wwDev?: boolean;
    actions?: Array<{ code: string; [key: string]: unknown }>;
    editor?: { designSystemId?: string };
}
