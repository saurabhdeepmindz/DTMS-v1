import { defineStore } from 'pinia';
import { ref } from 'vue';

import integrationCore from '@/extensions/integrations/index.js';

const HOOKS = ['init', 'auth-refresh'];

export const useHooksStore = defineStore('hooks', () => {
    const registeredHooks = ref(
        HOOKS.reduce((acc, hook) => {
            acc[hook] = {};
            return acc;
        }, {})
    );

    const integrationsStore = wwLib.store.integrations;
    function registerIntegrationHooks() {
        Object.entries(integrationCore).forEach(([integrationKey, integrationCore]) => {
            Object.entries(integrationCore?.hooks || {}).forEach(([hook, callback]) => {
                registerHook(hook, 'integration:' + integrationKey, callback);
            });
        });
    }

    function registerHook(hook, key, callback) {
        if (!HOOKS.includes(hook)) throw new Error(`Hook ${hook} is not registered`);
        registeredHooks.value[hook][key] = callback;
    }

    function unregisterHook(hook, key) {
        delete registeredHooks.value[hook][key];
    }

    async function executeHook(hook, ...args) {
        const [hookType, key] = hook.split('/');

        if (!HOOKS.includes(hookType)) throw new Error(`Hook ${hookType} is not registered`);

        if (key) {
            await registeredHooks.value[hookType][key](...args);
        } else {
            await Promise.all(
                Object.entries(registeredHooks.value[hook]).map(([key, callback]) => {
                    if (key.startsWith('integration:')) {
                        const integration = key.split(':')[1];
                        if (!integrationsStore.installed.includes(integration)) return;
                    }
                    return callback(...args);
                })
            );
        }
    }

    return {
        registeredHooks,
        registerHook,
        unregisterHook,
        executeHook,
        registerIntegrationHooks,
    };
});
