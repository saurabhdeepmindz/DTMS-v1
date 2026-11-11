import { effectScope, onBeforeUnmount, watch, watchEffect } from 'vue';

import {
    createStyleCompiler,
    decodeStyleRuntimeManifestData,
    type StyleAtomicClassAssignment,
    type StyleCompilerMode,
    type StyleReactivityRuntime,
    type StyleRuntimeAtomicClassAssignment,
} from '@/_common/helpers/styleCompiler';
import { createEditorStyleCompilerSources } from '@/_front/helpers/styleCompilerReader';
import { createReactiveCompileScope } from '@/_front/helpers/styleCompilerRuntimeScope';
import { createDomStyleSheetAdapter } from '@/_front/services/styleCompilerDomStyleSheet';
import { registerStyleDynamicVariables } from '@/_front/services/styleCompilerRuntimeVariables';
import { registerStyleAtomicClasses } from '@/_front/services/styleCompilerAtomicClasses';

const vueStyleCompilerRuntime: StyleReactivityRuntime = {
    createScope() {
        return effectScope();
    },
    effect(callback) {
        return watchEffect(callback);
    },
};

/**
 * Mounts the shared style compiler into the editor/front document.
 */
export function usePageStyleCompilerRuntime(mode: Extract<StyleCompilerMode, 'editor' | 'runtime'> = 'editor') {
    if (mode === 'runtime') {
        usePublishedPageStyleRuntime();
        return;
    }

    const stop = mountStyleCompiler(mode);
    onBeforeUnmount(stop);
}

function usePublishedPageStyleRuntime() {
    let stopCurrentRuntime: () => void = () => {};
    const stopManifestWatch = watch(
        () => {
            const page = wwLib.store.websiteData.page;
            const pageStyleSourceUids = wwLib.store.websiteData.styleSourceUids;
            const sourceUids = Array.isArray(pageStyleSourceUids)
                ? pageStyleSourceUids
                : [
                      ...Object.keys(wwLib.store.websiteData.sections || {}),
                      ...Object.keys(wwLib.store.websiteData.wwObjects || {}),
                  ];
            return [page?.id, page?._sm, sourceUids] as const;
        },
        ([, manifest, sourceUids]) => {
            stopCurrentRuntime();
            const manifestData = decodeStyleRuntimeManifestData(manifest);
            if (!manifestData) {
                stopCurrentRuntime = mountStyleCompiler('runtime');
                return;
            }

            const atomicClasses = resolvePublishedAtomicClasses(manifestData.atomicClasses, sourceUids);
            if (!atomicClasses) {
                stopCurrentRuntime = mountStyleCompiler('runtime');
                return;
            }

            const stops = [registerStyleDynamicVariables(manifestData.variables)];
            if (atomicClasses.length) {
                stops.push(registerStyleAtomicClasses(atomicClasses));
            }
            stopCurrentRuntime = () => {
                for (let index = stops.length - 1; index >= 0; index--) stops[index]();
            };
        },
        { immediate: true }
    );

    onBeforeUnmount(() => {
        stopManifestWatch();
        stopCurrentRuntime();
    });
}

function resolvePublishedAtomicClasses(
    assignments: readonly StyleRuntimeAtomicClassAssignment[],
    sourceUids: readonly string[]
) {
    return assignments.reduce<StyleAtomicClassAssignment[] | null>((resolved, assignment) => {
        if (!resolved) return null;
        if ('sourceUid' in assignment) {
            resolved.push(assignment);
            return resolved;
        }

        const sourceUid = sourceUids[assignment.sourceIndex];
        if (!sourceUid) return null;
        resolved.push({
            sourceUid,
            surfaceKind: assignment.surfaceKind,
            className: assignment.className,
        });
        return resolved;
    }, []);
}

function mountStyleCompiler(mode: Extract<StyleCompilerMode, 'editor' | 'runtime'>) {
    const sources = createEditorStyleCompilerSources();
    const run = createStyleCompiler().compileStylesheet({
        scope: createReactiveCompileScope(sources.scope),
        reader: sources.reader,
        stylesheet: createDomStyleSheetAdapter(),
        runtime: vueStyleCompilerRuntime,
        mode,
        assetBaseUrl: import.meta.env.VITE_APP_CDN_URL,
    });

    return run.stop;
}
