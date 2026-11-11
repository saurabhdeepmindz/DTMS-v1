import { watchEffect, shallowReactive } from 'vue';

import { cloneDeep } from 'lodash-es';
import { pluginLifecycleScheduler } from './pluginLifecycleScheduler';

export default {
    /** @PUBLIC_API Reactive plugin metadata indexed by project plugin ID. */
    get pluginsById() {
        return wwLib.store.websiteData.pluginsById;
    },
    /** @PUBLIC_API Reactive metadata for a project plugin. */
    getPluginById(id) {
        return wwLib.store.websiteData.pluginsById[id];
    },
    /** @PUBLIC_API Save plugin settings before updating their local reactive value. */
    updateSettings({ pluginId, settings }) {
        return wwLib.store.websiteData.updatePluginSettings({ pluginId, settings });
    },
     async registerPlugin(componentId, content, devOptions = null) {
        const plugin =
            wwLib.store.websiteData.pluginsByComponentId[componentId] ||
            wwLib.store.websiteData.pluginsByNamespace[componentId] ||
            (await wwLib.store.websiteData.addDevPlugin({ ...(devOptions || {}) }));
        if (!wwLib.wwPlugins) wwLib.wwPlugins = shallowReactive({});
        let settings;
         /* wwFront:start */
        // eslint-disable-next-line
        settings = window.wwg_pluginsSettings[plugin.id] || { publicData: {}, privateData: {} };
        /* wwFront:end */

        const store = wwLib.store.componentBases;
        const config = store.configurations[componentId];
 
        wwLib.store.websiteData.updatePlugin({
            pluginId: plugin.id,
            settings,
            isLoaded: plugin.isLoaded || false,
        });

        this.mountPlugin(plugin, {
            content: this._devPlugins[plugin.namespace]?.content || content,
            config: this._devPlugins[plugin.namespace]?.config || config,
            settings,
        });

     },
    mountPlugin(plugin, { content = {}, config = {}, settings = {} }) {
        wwLib.wwPlugins[plugin.namespace] = {
            ...content,
            name: plugin.name,
            namespace: plugin.namespace,
            isDev: plugin.isDev,
            get id() {
                const pluginFound = wwLib.store.websiteData.pluginsByNamespace[plugin.namespace] || {};
                return pluginFound.id;
            },
            get isLoaded() {
                const pluginFound = wwLib.store.websiteData.pluginsByNamespace[plugin.namespace] || {};
                return wwLib.store.websiteData.isPluginLoaded(pluginFound.id);
            },
            get settings() {
                const pluginFound = wwLib.store.websiteData.pluginsByNamespace[plugin.namespace] || {};
                return cloneDeep(
                    wwLib.store.websiteData.resolvePluginSettings(pluginFound.id) || {
                        publicData: {},
                        privateData: {},
                    }
                );
            },
        };
        // Retrocompatibility for defining pluginValue for formulas
        if (plugin.id !== plugin.namespace) {
            wwLib.wwPlugins[plugin.id] = wwLib.wwPlugins[plugin.namespace];
        }

        const variablesStore = wwLib.store.variables;
        let variables = config?.variables;
        if (typeof variables === 'function') {
            variables = variables(settings);
        } else if (typeof variables === 'object' && !Array.isArray(variables)) {
            variables = Object.values(variables);
        }

        (variables || []).forEach(variable => {
            variablesStore.add('plugin', `${plugin.id}-${variable.name}`, {
                ...variable,
                pluginId: plugin.id,
                id: `${plugin.id}-${variable.name}`,
                value: variable.defaultValue,
                defaultValue: variable.defaultValue,
            });
            variablesStore.values[`${plugin.id}-${variable.name}`] = cloneDeep(variable.defaultValue);
            Object.defineProperty(wwLib.wwPlugins[plugin.namespace], variable.name, {
                get() {
                    return variablesStore.values[`${plugin.id}-${variable.name}`];
                },
                set(value) {
                    wwLib.wwVariable.updateValue(`${plugin.id}-${variable.name}`, value);
                },
            });
        });

        (config?.formulas || []).forEach(formula => {
            wwLib.store.data.setPluginFormula({
                ...formula,
                pluginId: plugin.id,
                id: `${plugin.id}-${formula.name}`,
            });
        });

         const isLoaded = pluginLifecycleScheduler.register(async () => {
            try {
                if (wwLib.wwPlugins[plugin.namespace]._onLoad)
                    await wwLib.wwPlugins[plugin.namespace]._onLoad(settings);
                else if (wwLib.wwPlugins[plugin.namespace].onLoad)
                    await wwLib.wwPlugins[plugin.namespace].onLoad(settings);
            } catch (err) {
                wwLib.wwLog.error(err);
            }
            wwLib.store.websiteData.updatePlugin({
                pluginId: plugin.id,
                isLoaded: true,
            });
        });

        this._pluginPromises.push(isLoaded);
    },
    async initPlugins() {
        await this.activatePlugins();
        await this.waitPluginsLoaded();
    },
    async activatePlugins() {
        await pluginLifecycleScheduler.activate();
    },
    async waitPluginsLoaded() {
        return await Promise.all(this._pluginPromises);
    },
    _pluginPromises: [],
    _devPlugins: {},
};
