import { defineStore } from 'pinia';
/* wwFront:start */
import { getFrontEnvVariables } from '@/helpers/frontEnv.js';
/* wwFront:end */
 
export const useEnvVariablesStore = defineStore('envVariables', () => {
    let values;
    /* wwFront:start */
    values = getFrontEnvVariables();
    /* wwFront:end */
 
 
    return {
        values,
     };
});
