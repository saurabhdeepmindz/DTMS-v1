import { ref } from 'vue';

import { createDateFormulas } from './dateFormulaCore';

const realtimeDate = ref(new Date().toISOString());
setInterval(() => {
    realtimeDate.value = new Date().toISOString();
}, 1000);

export const dateFormulas = createDateFormulas({
    getLanguage() {
        try {
            return wwLib.store.front.lang || 'en';
        } catch {
            return 'en';
        }
    },
    getRealtimeDate() {
        return realtimeDate.value;
    },
});

export { DATE_FORMULAS_CATEGORY } from './dateFormulaCore';
