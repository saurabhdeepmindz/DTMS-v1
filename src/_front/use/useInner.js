import { cloneDeep, set } from 'lodash-es';
import { computed, onUnmounted, reactive, watch, onMounted, inject } from 'vue';
import { checkVariableType } from '@/_common/helpers/updateVariable.js';
import { getValue } from '@/_common/helpers/code/customCode.js';

import { escapeHTMLInObject } from '@/_common/helpers/htmlEscaper.js';
export function useInner(baseUid, { context, props }, componentIdentifier) {
    const sectionId = inject('sectionId', null);
    const variablesStore = wwLib.store.variables;

    const variableConfiguration = computed(() => wwLib.store.libraries.components[baseUid]?.inner?.variables || {});
    const formulaConfiguration = computed(() => wwLib.store.libraries.components[baseUid]?.inner?.formulas || {});

    const bindingContext = inject('bindingContext', null);
    const isInsideRepeat = computed(() => bindingContext !== null);

    const variables = reactive({});
    const formulas = reactive({});
    const componentVariablesConfiguration = reactive({});
    const externalVariablesIds = {};

    Object.keys(variableConfiguration.value).forEach(key => {
        variables[key] = cloneDeep(variableConfiguration.value[key].defaultValue);
        if (variableConfiguration.value[key].isExternal && !isInsideRepeat.value) {
            if (context?.component) {
                externalVariablesIds[key] = wwLib.wwVariable.registerLibraryComponentVariable({
                    uid: componentIdentifier.uid,
                    componentType: 'libraryComponent',
                    name: variableConfiguration.value[key].name,
                    id: `${componentIdentifier.uid}-${variableConfiguration.value[key].id}`,
                    defaultValue: variableConfiguration.value[key].defaultValue,
                    type: variableConfiguration.value[key].type,
                    readonly: true,
                    resettable: false,
                    libraryContext: context,
                    sectionId,
                });
            } else {
                externalVariablesIds[key] = wwLib.wwVariable.registerComponentVariable({
                    uid: componentIdentifier.uid,
                    componentType: 'libraryComponent',
                    name: variableConfiguration.value[key].name,
                    id: `${componentIdentifier.uid}-${variableConfiguration.value[key].id}`,
                    defaultValue: variableConfiguration.value[key].defaultValue,
                    type: variableConfiguration.value[key].type,
                    readonly: true,
                    resettable: false,
                    sectionId,
                });
            }
        }
    });

    function setFormula(formulaId) {
        formulas[formulaId] = (...args) => {
            const __wwParameters = (formulaConfiguration.value?.[formulaId]?.parameters || []).map(
                parameter => parameter.name || ''
            );
            const __wwClosureParameters = [
                'getValue',
                'context',
                'baseUid',
                'props',
                'variables',
                'formulas',
                'args',
                '__wwItem',
                ...__wwParameters,
            ];
            // eslint-disable-next-line no-unused-vars
            const __wwargs = [
                getValue,
                context,
                baseUid,
                props,
                variables,
                formulas,
                args,
                formulaConfiguration.value?.[formulaId],
                ...args,
            ];

            return new Function(
                ...__wwClosureParameters,
                ` return getValue(
                    {...__wwItem, __wwtype: __wwItem.type},
                    {...context, component: { baseUid, props, variables, formulas }},
                    { recursive: false, args: {names: '${__wwParameters.join(', ')}', value: args } }
                );`
            )(...__wwargs);
        };
    }

    Object.keys(formulaConfiguration.value).forEach(key => {
        setFormula(key);
    });

 
    return {
        variables,
        formulas,
        updateVariable(variableId, value, { path, index, arrayUpdateType, workflowContext = {} } = {}) {
            workflowContext = {
                ...(workflowContext || {}),
                executionContext: {
                    ...(workflowContext?.executionContext || {}),
                    libraryComponentIdentifier: { ...componentIdentifier, baseUid },
                },
            };
            const variable = variableConfiguration.value[variableId] || componentVariablesConfiguration[variableId];
            try {
                if (!variable) {
                     throw new Error('variable not found');
                }

                if (value === undefined && !['delete', 'shift', 'pop'].includes(arrayUpdateType)) {
                    return;
                }

                value = checkVariableType(variable, value, { path, arrayUpdateType });
                if (value && typeof value === 'object' && ['object', 'array'].includes(variable.type)) {
                    // Here we need to be sure we are not sharing object instance inside variable.
                    // This may be overkill sometimes, but then we are sure to handle all corner cases when this is relevant
                    value = _.cloneDeep(value);
                }

                if (variable.type === 'object' && path) {
                    variables[variableId] = variables[variableId] || {};
                    set(variables[variableId], path, value);
                } else if (variable.type === 'array' && arrayUpdateType) {
                    variables[variableId] = variables[variableId] || [];
                    index = index || 0;
                    switch (arrayUpdateType) {
                        case 'update': {
                            let finalPath = `[${index}]`;
                            if (path) {
                                finalPath = `${finalPath}.${path}`;
                            }
                            set(variables[variableId], finalPath, value);
                            break;
                        }
                        case 'delete':
                            variables[variableId].splice(index, 1);
                            break;
                        case 'insert':
                            variables[variableId].splice(index, 0, value);
                            break;
                        case 'unshift':
                            variables[variableId].unshift(value);
                            break;
                        case 'push':
                            variables[variableId].push(value);
                            break;
                        case 'shift':
                            variables[variableId].shift(value);
                            break;
                        case 'pop':
                            variables[variableId].pop(value);
                            break;
                    }
                } else {
                    variables[variableId] = value;
                }

                if (variable.isExternal && externalVariablesIds[variableId]) {
                    if (context?.component) {
                        context.component.methods.updateVariable(externalVariablesIds[variableId], value, {
                            path,
                            index,
                            arrayUpdateType,
                            workflowContext,
                        });
                    } else {
                        wwLib.wwVariable.updateValue(externalVariablesIds[variableId], value, {
                            path,
                            index,
                            arrayUpdateType,
                            workflowContext,
                        });
                    }
                }

                return value;
            } catch (error) {
             }
        },
        componentVariablesConfiguration,
    };
}
