export type ClientIslandDiagnosticCategory =
    | 'component-module-load-error'
    | 'component-render-error'
    | 'invalid-rich-text-markup';

export class ClientIslandRenderError extends Error {
    readonly category: Exclude<ClientIslandDiagnosticCategory, 'component-render-error'>;

    constructor(category: Exclude<ClientIslandDiagnosticCategory, 'component-render-error'>, message: string) {
        super(message);
        this.name = 'ClientIslandRenderError';
        this.category = category;
    }
}
