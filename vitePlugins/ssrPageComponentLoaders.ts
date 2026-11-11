import type { Plugin } from 'vite';

const COMPONENT_IMPORTS_START = '/*__WW_PAGE_COMPONENT_IMPORTS_START__*/';
const COMPONENT_IMPORTS_END = '/*__WW_PAGE_COMPONENT_IMPORTS_END__*/';
const COMPONENT_DESCRIPTORS_START = '/*__WW_SSR_PAGE_COMPONENT_DESCRIPTORS_START__*/';
const COMPONENT_DESCRIPTORS_END = '/*__WW_SSR_PAGE_COMPONENT_DESCRIPTORS_END__*/';
const PAGE_MODULE_PATTERN = /[/\\]src[/\\]pages[/\\][^/\\]+\.js$/;

type PageComponentDescriptor = {
    baseId: string;
    importPath: string;
    name: string;
    type: 'element' | 'section';
};

type MarkedRegion = {
    content: string;
    end: number;
    start: number;
};

export function createSsrPageComponentLoadersPlugin(): Plugin {
    return {
        name: 'weweb-ssr-page-component-loaders',
        enforce: 'pre',
        transform(code, id, options) {
            if (!options?.ssr || !PAGE_MODULE_PATTERN.test(stripQuery(id))) return null;

            try {
                return transformSsrPageComponentLoaders(code);
            } catch (error) {
                this.error(error instanceof Error ? error.message : `${error}`);
            }
        },
    };
}

export function transformSsrPageComponentLoaders(code: string): { code: string; map: null } | null {
    if (!code.includes(COMPONENT_DESCRIPTORS_START)) return null;

    const descriptorRegion = getMarkedRegion(
        code,
        COMPONENT_DESCRIPTORS_START,
        COMPONENT_DESCRIPTORS_END,
        'component descriptor'
    );
    const descriptors = parseDescriptors(descriptorRegion.content);
    const importRegion = getMarkedRegion(code, COMPONENT_IMPORTS_START, COMPONENT_IMPORTS_END, 'component import');
    const codeWithoutImports = replaceRegion(code, importRegion, '');
    const adjustedDescriptorRegion = getMarkedRegion(
        codeWithoutImports,
        COMPONENT_DESCRIPTORS_START,
        COMPONENT_DESCRIPTORS_END,
        'component descriptor'
    );

    return {
        code: replaceRegion(codeWithoutImports, adjustedDescriptorRegion, serializeLoaders(descriptors)),
        map: null,
    };
}

function parseDescriptors(source: string): PageComponentDescriptor[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(source);
    } catch {
        throw new Error('Generated page component descriptors are not valid JSON.');
    }

    if (!Array.isArray(parsed)) throw new Error('Generated page component descriptors must be an array.');

    const descriptors: PageComponentDescriptor[] = [];
    const componentNames = new Set<string>();
    for (const value of parsed) {
        const descriptor = validateDescriptor(value);
        if (componentNames.has(descriptor.name)) {
            throw new Error(`Generated page component descriptor ${descriptor.name} is duplicated.`);
        }
        componentNames.add(descriptor.name);
        descriptors.push(descriptor);
    }
    return descriptors;
}

function validateDescriptor(value: unknown): PageComponentDescriptor {
    if (!isRecord(value)) throw new Error('Generated page component descriptor must be an object.');

    const expectedKeys = ['baseId', 'importPath', 'name', 'type'];
    const keys = Object.keys(value).sort();
    if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
        throw new Error('Generated page component descriptor has an invalid shape.');
    }

    const { baseId, importPath, name, type } = value;
    if (typeof baseId !== 'string' || !baseId || baseId.includes('/') || baseId.includes('\\')) {
        throw new Error('Generated page component descriptor has an invalid baseId.');
    }
    if (type !== 'element' && type !== 'section') {
        throw new Error(`Generated page component descriptor ${baseId} has an invalid type.`);
    }

    const expectedName = type === 'element' ? `wwobject-${baseId}` : `section-${baseId}`;
    if (name !== expectedName) {
        throw new Error(`Generated page component descriptor ${baseId} has an invalid name.`);
    }

    const expectedPackageImport = `@weweb-internal/ext-${type}-${baseId.toLowerCase()}`;
    if (importPath !== expectedPackageImport) {
        throw new Error(`Generated page component descriptor ${baseId} has an invalid importPath.`);
    }

    return { baseId, importPath, name, type };
}

function getMarkedRegion(code: string, startMarker: string, endMarker: string, label: string): MarkedRegion {
    const start = code.indexOf(startMarker);
    if (start === -1) throw new Error(`Generated page is missing its ${label} start marker.`);
    if (code.indexOf(startMarker, start + startMarker.length) !== -1) {
        throw new Error(`Generated page contains multiple ${label} start markers.`);
    }

    const contentStart = start + startMarker.length;
    const endMarkerStart = code.indexOf(endMarker, contentStart);
    if (endMarkerStart === -1) throw new Error(`Generated page is missing its ${label} end marker.`);
    if (code.indexOf(endMarker, endMarkerStart + endMarker.length) !== -1) {
        throw new Error(`Generated page contains multiple ${label} end markers.`);
    }

    return {
        content: code.slice(contentStart, endMarkerStart).trim(),
        end: endMarkerStart + endMarker.length,
        start,
    };
}

function replaceRegion(code: string, region: MarkedRegion, replacement: string): string {
    return `${code.slice(0, region.start)}${replacement}${code.slice(region.end)}`;
}

function serializeLoaders(descriptors: PageComponentDescriptor[]): string {
    return `[
${descriptors
    .map(
        ({ baseId, importPath, name, type }) =>
            `        { baseId: ${JSON.stringify(baseId)}, name: ${JSON.stringify(name)}, type: ${JSON.stringify(
                type
            )}, load: () => import(${JSON.stringify(importPath)}) }`
    )
    .join(',\n')}
    ]`;
}

function stripQuery(id: string): string {
    return id.split('?', 1)[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
