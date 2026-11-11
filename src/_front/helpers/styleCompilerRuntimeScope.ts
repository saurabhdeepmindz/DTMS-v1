import type { Ref } from 'vue';

import type { StyleCompileScope } from '@/_common/helpers/styleCompiler';

/**
 * Keeps the compiler target-list scope reactive without making the compiler depend on Vue refs.
 */
export function createReactiveCompileScope(scope: Ref<StyleCompileScope>): StyleCompileScope {
    return {
        get elementUids() {
            return scope.value.elementUids;
        },
        get sectionUids() {
            return scope.value.sectionUids;
        },
        get libraryElementUids() {
            return scope.value.libraryElementUids;
        },
        get libraryComponentIds() {
            return scope.value.libraryComponentIds;
        },
    };
}
