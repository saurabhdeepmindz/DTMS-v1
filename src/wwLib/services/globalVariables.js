import { reactive } from 'vue';

export default {
    _navigationId: 0,
    get customCodeVariables() {
        return wwLib.store.variables.customCodeVariables;
    },
    globalComponentActionsFn: reactive({
        sections: {},
        elements: {},
        libraryComponents: {},
    }),
 };
