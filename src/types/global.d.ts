import type { Context as HonoContext } from 'hono';

declare global {
    type IntegrationArgs = { [key: string]: any | undefined };
    type ActionParams<TArgs = IntegrationArgs> = {
        args: TArgs;
    };
    type ActionContext = {
        workflowDefinition?: { id: string };
        connection?: ConnectionConfig;
        honoContext: HonoContext;
    };
    type ConnectionConfig = {
        [key: string]: string | undefined | any;
    };
    type StorageRuntimeConfig = {
        env: 'current' | 'editor' | 'staging' | 'production';
        integration?: string;
        connectionId?: string;
        cdnUrl?: string;
        privateBucket?: string;
        publicBucket?: string;
        privatePrefix?: string;
        publicPrefix?: string;
        appUrl?: string;
        proxyUrl?: string;
        projectId?: string;
    };
    type TableConfig<TConfig = IntegrationArgs> = TConfig;
    type ViewConfig<TColumns = any, TFilters = any, TLimit = any, TOffset = any> = {
        [key: string]: any | undefined;
        columns?: TColumns;
        filters?: TFilters;
        joinTypes?: Record<string, string>;
        sort?: Array<{ field?: string | string[]; direction?: 'ASC' | 'DESC' | string }>;
        limit?: TLimit;
        offset?: TOffset;
        count?: 'exact' | 'planned' | 'estimated' | null;
    };
    type TableViewHandler<
        TConnection = ConnectionConfig,
        TTable = TableConfig,
        TView = ViewConfig,
    > = (connection: TConnection, table: TTable, view: TView) => unknown | Promise<unknown>;
    type ActionHandler<TArgs = IntegrationArgs> = (
        action: ActionParams<TArgs>,
        context: ActionContext,
        helpers?: any
    ) => unknown | Promise<unknown>;
    var actions: Record<string, ActionHandler>;
    var registerAction: <TArgs = IntegrationArgs>(
        type: string,
        handler: ActionHandler<TArgs>
    ) => void;
    var tableViews: Record<string, TableViewHandler>;
    var registerTableView: <
        TConnection = ConnectionConfig,
        TTable = TableConfig,
        TView = ViewConfig,
    >(
        integration: string,
        handler: TableViewHandler<TConnection, TTable, TView>
    ) => void;
    type TableLinkDefinition<TTable = TableConfig> = {
        [key: string]: any | undefined;
        tableConfig?: TTable;
        columns?: string[];
    };
}

export {};
