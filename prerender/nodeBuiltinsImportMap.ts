import { builtinModules } from 'node:module';

export type NodeBuiltinsImportMap = {
    imports: Record<string, string>;
};

export function createNodeBuiltinsImportMap(): NodeBuiltinsImportMap {
    const imports: Record<string, string> = {};

    for (const builtinModule of builtinModules) {
        const moduleName = builtinModule.startsWith('node:') ? builtinModule.slice('node:'.length) : builtinModule;
        imports[moduleName] = `node:${moduleName}`;
    }

    return { imports };
}
