import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

import type { StyleCompileScope } from '@/_common/helpers/styleCompiler';
import { createReactiveCompileScope } from '@/_front/helpers/styleCompilerRuntimeScope';

describe('useStyleCompilerRuntime', () => {
    it('forwards library definition element uids through the reactive compile scope', () => {
        const scope = ref<StyleCompileScope>({
            elementUids: ['pageElement'],
            sectionUids: ['sectionA'],
            libraryElementUids: ['libraryChild'],
            libraryComponentIds: ['libraryA'],
        });
        const reactiveScope = createReactiveCompileScope(scope);

        expect(reactiveScope.libraryElementUids).toEqual(['libraryChild']);

        scope.value = {
            elementUids: ['nextPageElement'],
            sectionUids: ['sectionB'],
            libraryElementUids: ['nextLibraryChild'],
            libraryComponentIds: ['libraryB'],
        };

        expect(reactiveScope.elementUids).toEqual(['nextPageElement']);
        expect(reactiveScope.libraryElementUids).toEqual(['nextLibraryChild']);
        expect(reactiveScope.libraryComponentIds).toEqual(['libraryB']);
    });
});
