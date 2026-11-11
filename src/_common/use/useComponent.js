import { get } from 'lodash-es';
import { computed, reactive, inject, provide, watch, ref, onMounted, onBeforeUnmount, nextTick } from 'vue';

import { getComponentConfiguration, getDisplayValue } from '@/_common/helpers/component/component.js';
import { STYLE_CONFIGURATION, STATE_CONFIGURATION } from '@/_common/helpers/configuration/configurationCommon.js';
import { inheritFrom } from '@/_common/helpers/configuration/configuration.js';
import { getValue } from '@/_common/helpers/code/customCode.js';
import { executeWorkflow } from '@/_common/helpers/code/workflows.js';
import { getComponentRawProperty } from '@/_common/helpers/component/componentProperty.js';
import {
    resolveLibraryComponentConditionalRendering,
    resolveLibraryComponentLayoutValue,
    resolveLibraryComponentRawLayoutValue,
} from '@/_common/helpers/component/libraryComponentRendering';
import { lazySet } from '@/_common/helpers/reactivity.js';

import { scheduleRuntimeLifecycle } from '@/_front/rendering/runtimeLifecycleScheduler';

export function useComponentData({
    type,
    uid,
    componentId,
    currentStates,
    context = {},
    libraryComponentDataRef,
    wwProps = {},
 }) {
    const websiteData = wwLib.store.websiteData;
    // Cache registry reads in this render path while tracking registry replacement.
    const wwObjects = computed(() => websiteData.wwObjects);
    const sections = computed(() => websiteData.sections);
    let content = {};
    let rawContent = {};
    let sidepanelContent = reactive({
        content: {},
        _state: {},
    });
    let rawState = {};
    let state = {};

    const popupsStore = wwLib.store.popups;

 
    const configuration = getComponentConfiguration(type, uid);
    const component = computed(() => {
        if (type === 'section') {
            return sections.value[uid];
        } else if (uid.startsWith('popup-')) {
            return popupsStore.instances[uid];
        } else {
            return wwObjects.value[uid];
        }
    });
    const layers = inject('_wwLibraryComponentLayers', {});

    for (let propertyName in configuration.properties) {
        const propertyConfiguration = configuration.properties[propertyName];
        if (!propertyConfiguration.editorOnly) {
            setContentProperty(propertyName, propertyConfiguration, {
                component,
                currentStates,
                libraryComponentDataRef,
                 context,
                content,
                rawContent,
                layers,
            });
         }
    }

    // No per-style-prop loop here anymore: element CSS (incl. animation) is rendered by the compiler, and
    // library style overrides go through its CSS cascade layers. Conditional rendering and the two layout
    // cleanup values are the targeted runtime exceptions forwarded by wwLibraryComponent. STYLE_CONFIGURATION
    // has no `editorOnly` style prop (audited editor + assets), so `sidepanelContent._state.style` is never
    // populated. Editor-only STATE props (e.g. forceRendering) are still mirrored by the state loop below.
    for (const propertyName in STATE_CONFIGURATION) {
        if (propertyName === 'interactions') {
            const rawProperty = computed(() => component.value?._state?.interactions);
            // eslint-disable-next-line vue/no-ref-as-operand
            state.interactions = rawProperty;
            // eslint-disable-next-line vue/no-ref-as-operand
            rawState.interactions = rawProperty;
        } else if (!STATE_CONFIGURATION[propertyName].editorOnly) {
            const rawProperty = computed(() =>
                getComponentRawProperty({
                    dataRef: component,
                    prefix: '_state',
                    suffix: propertyName,
                    propertyConfiguration: STATE_CONFIGURATION[propertyName],
                    statesRef: currentStates,
                    libraryComponentDataRef,
                 })
            );
            const property = computed(() =>
                getValue(rawProperty.value, context, {
                    defaultUndefined: STATE_CONFIGURATION[propertyName].fallbackToDefault
                        ? STATE_CONFIGURATION[propertyName].defaultValue
                        : STATE_CONFIGURATION[propertyName].defaultUndefined,
                })
            );
            // eslint-disable-next-line vue/no-ref-as-operand
            state[propertyName] = property;
            rawState[propertyName] = rawProperty;
         }
    }

    if (type === 'libraryComponent') {
        const rawProperty = computed(() => component.value?.content?.default?.childrenData || {});
        // eslint-disable-next-line vue/no-ref-as-operand
        content.childrenData = rawProperty;
        // eslint-disable-next-line vue/no-ref-as-operand
        rawContent.childrenData = rawProperty;
    }

    content = reactive(content);
    rawContent = reactive(rawContent);
    rawState = reactive(rawState);
    state = reactive(state);

 
    // Resolve a single style prop from the data, INDEPENDENTLY of the monolithic `style` object (so
    // targeted consumers survive `style`'s removal). Ungated so it can feed front computeds too; the
    // `useEditorKeyframesRef` param is gated inline (as in the style loop).
    const resolveRawStyleProperty = suffix =>
        getComponentRawProperty({
            dataRef: component,
            prefix: '_state.style',
            suffix,
            propertyConfiguration: STYLE_CONFIGURATION[suffix],
            statesRef: currentStates,
            libraryComponentDataRef,
         });

    const resolveStyleProperty = suffix => {
        const fallback = () =>
            getValue(resolveRawStyleProperty(suffix), context, {
                defaultUndefined: STYLE_CONFIGURATION[suffix].fallbackToDefault
                    ? STYLE_CONFIGURATION[suffix].defaultValue
                    : STYLE_CONFIGURATION[suffix].defaultUndefined,
            });

        if (suffix !== 'display' && suffix !== 'textAlign') return fallback();

        return resolveLibraryComponentLayoutValue(libraryComponentDataRef?.value, suffix, fallback);
    };

    // conditionalRendering drives `isRendering` (v-if) on FRONT + editor. Same resolution as the
    // navigator's eye icon. Library roots receive the instance's value through a dedicated rendering
    // payload, keeping the removed runtime style object out of the component contract.
    const resolveRawConditionalRendering = () =>
        resolveLibraryComponentConditionalRendering(libraryComponentDataRef?.value, () =>
            resolveRawStyleProperty('conditionalRendering')
        );
    const rawConditionalRendering = type === 'libraryComponent' ? computed(resolveRawConditionalRendering) : undefined;
    const componentConditionalRendering = computed(() =>
        getValue(
            type === 'libraryComponent' ? rawConditionalRendering.value : resolveRawConditionalRendering(),
            context,
            {
                defaultUndefined: STYLE_CONFIGURATION.conditionalRendering.fallbackToDefault
                    ? STYLE_CONFIGURATION.conditionalRendering.defaultValue
                    : STYLE_CONFIGURATION.conditionalRendering.defaultUndefined,
            }
        )
    );

    // Rendering flag (component v-if), factored here (identical in wwElementComponent/wwSectionComponent;
    // wwLibraryComponent delegates to its root element). On the published site it IS
    // `componentConditionalRendering` (no extra computed); in the editor it also honors force-render.
    let isRendering;
     /* wwFront:start */
    // eslint-disable-next-line vue/no-ref-as-operand
    isRendering = componentConditionalRendering;
    /* wwFront:end */

    // Targeted resolved layout values for wwLayout. These stay outside the general runtime style
    // object: only block cleanup and push-last require current-state runtime arbitration.
    const resolveRawLayoutProperty = suffix =>
        resolveLibraryComponentRawLayoutValue(libraryComponentDataRef?.value, suffix, () =>
            resolveRawStyleProperty(suffix)
        );
    // Keep the front runtime contract lazy: the rendered layout's existing computed tracks these
    // accessors, so components without a rendered layout allocate no additional computed refs.
    const componentLayoutRuntime = {
        inheritsLayout: !!inheritFrom(configuration, 'ww-layout'),
        display: () => getDisplayValue(resolveStyleProperty('display'), configuration, { content, wwProps }),
        textAlign: () => resolveStyleProperty('textAlign'),
    };
    if (type === 'libraryComponent') {
        Object.assign(componentLayoutRuntime, {
            rawDisplay: () => resolveRawLayoutProperty('display'),
            displayValue: () => resolveStyleProperty('display'),
            rawTextAlign: () => resolveRawLayoutProperty('textAlign'),
        });
    }

 
 
    if (type === 'libraryComponent') {
        // TODO ?
    } else {
        provide('componentContent', content);
        provide('componentState', state);
        provide('componentLayoutRuntime', componentLayoutRuntime);
         provide('componentRawContent', rawContent);
        provide('componentData', component);
        provide('componentWwProps', wwProps);
    }

    return {
        content,
        isRendering,
        componentConditionalRendering,
        rawConditionalRendering,
        componentLayoutRuntime,
         state,
        rawContent,
        rawState,
        name: computed(() => component.value && component.value.name),
        configuration,
    };
}

export function useParentContentProperty(path) {
    const componentContent = inject('componentContent');
    const componentRawContent = inject('componentRawContent');

    return {
        property: computed(() => get(componentContent, path.value)),
        rawProperty: computed(() => get(componentRawContent, path.value)),
    };
}

const LOG_TYPE = {
    section: 's',
    element: 'e',
    libraryComponent: 'c',
};

export function useComponentTriggerEvent(
    {
        state,
        componentIdentifier,
        triggerLibraryComponentEvent,
        triggerParentEvent,
        parentInteractionsRef,
        isRenderingRef,
        rootElementRef,
        extraListeners = {},
        isRuntimePreview = false,
    },
    context = {}
) {
    const data = inject('componentData', ref({}));

 
    if (isRuntimePreview) {
        return { triggerEvent: () => {}, listeners: computed(() => ({})) };
    }

    // Malformed (an element written by an AI): no workflows, rather than a broken element
    const getInteractions = () => (Array.isArray(state.interactions) ? state.interactions : []);

    function triggerEvent(name, event = {}) {
         const workflows = getInteractions().filter(({ trigger }) => trigger === name);

        // Launch all workflows in parallel
        workflows.forEach(workflow => {
            executeWorkflow(workflow, {
                context,
                event,
                executionContext: {
                    type: LOG_TYPE[componentIdentifier.type],
                    uid: componentIdentifier.uid,
                 },
            });
        });
    }

    if (componentIdentifier.type === 'libraryComponent') {
        return { triggerEvent };
    }
    const listeners = computed(() => {
        const allActionEvents = [
            ...new Set([...getInteractions(), ...(parentInteractionsRef?.value || [])].map(({ trigger }) => trigger)),
        ];
        const allEvents = allActionEvents
            .filter((item, pos) => item && allActionEvents.indexOf(item) === pos)
            .filter(eventName =>
                [
                    'click',
                    'dblclick',
                    'contextmenu',
                    'mousedown',
                    'mouseup',
                    'mousemove',
                    'mouseenter',
                    'mouseleave',
                    'touchstart',
                    'touchmove',
                    'touchend',
                    'touchcancel',
                    'scroll',
                ].includes(eventName)
            );

        const listeners = {};

        for (const eventName of allEvents) {
            listeners[`on${eventName[0].toUpperCase()}${eventName.substr(1)}`] = event => {
                if (eventName === 'contextmenu') {
                    // Allow native browser menu when Ctrl + Alt + Right Click (Windows/Linux) or Cmd + Option + Right Click (Mac)
                    if (!((event.ctrlKey && event.altKey) || (event.metaKey && event.altKey))) {
                        event.preventDefault();
                    }
                }
                // Trigger define on the library component instance level
                if (triggerParentEvent) {
                    triggerParentEvent(eventName, event);
                }
                triggerEvent(eventName, event);
            };
        }

        for (const [eventName, listener] of Object.entries(extraListeners)) {
            const tmp = listeners[eventName];
            listeners[eventName] = event => {
                listener(event);
                tmp?.(event);
            };
        }
        return listeners;
    });

    function triggerLifecycleEvent(eventName) {
        // Mount define on the library component level
        if (triggerLibraryComponentEvent) {
            triggerLibraryComponentEvent(eventName, {});
        }
        // Mount define in the library component instance level
        if (triggerParentEvent) {
            triggerParentEvent(eventName, {});
        }
        // Mount define by the element itself
        triggerEvent(eventName, {});
    }

    function scheduleLifecycleEvent(eventName) {
        scheduleRuntimeLifecycle(() => triggerLifecycleEvent(eventName));
    }

    watch(isRenderingRef, (isRendered, wasRendered) => {
        if (isRendered && !wasRendered) {
            // Next tick to ensure that the component is fully rendered
            nextTick(() => scheduleLifecycleEvent('_wwOnMounted'));
        } else if (!isRendered && wasRendered) {
            scheduleLifecycleEvent('_wwOnBeforeUnmount');
        }
    });

    const scrollListener = event => {
        triggerEvent('scroll', event);
    };

    if (rootElementRef) {
        // TODO: Verify if works with library components
        watch(rootElementRef, () => {
            if (rootElementRef?.value?.$el) {
                rootElementRef.value.$el.removeEventListener('scroll', scrollListener);
                rootElementRef.value.$el.addEventListener('scroll', scrollListener);
            }
        });
    }

    scheduleLifecycleEvent('_wwOnCreated');

    onMounted(() => {
        if (isRenderingRef.value) {
            scheduleLifecycleEvent('_wwOnMounted');
        }
    });

    onBeforeUnmount(() => {
        if (isRenderingRef.value) {
            scheduleLifecycleEvent('_wwOnBeforeUnmount');
        }

        if (rootElementRef?.value?.$el) {
            rootElementRef?.value?.$el.removeEventListener('scroll', scrollListener);
        }
    });

    return { triggerEvent, listeners };
}

export function useLibraryComponentWorkflow({ baseUid, componentIdentifier, isRuntimePreview = false }, context = {}) {
    if (isRuntimePreview) {
        return {
            triggerLibraryComponentEvent: () => {},
            executeLibraryComponentWorkflow: () => undefined,
        };
    }
    const librariesStore = wwLib.store.libraries;

    function triggerEvent(name, event = {}, property) {
        const workflows = Object.values(librariesStore.components[baseUid]?.inner?.workflows || {}).filter(
            ({ trigger, triggerProperty }) => trigger === name && (!property || property === triggerProperty)
        );
        // Launch all workflows in parallel
        workflows.forEach(workflow => {
            executeWorkflow(workflow, {
                context,
                event,
                internal: true,
                executionContext: {
                    type: LOG_TYPE[componentIdentifier.type],
                    uid: componentIdentifier.uid,
                 },
            });
        });
    }

    function executeLibraryComponentWorkflow(workflowId, parameters, { parentExecutionId } = {}) {
        const workflow = librariesStore.components[baseUid]?.inner?.workflows?.[workflowId];
        if (!workflow) {
            console.error(`Workflow with id ${workflowId} not found`);
            return;
        }
        return executeWorkflow(workflow, {
            context: { ...context, parameters },
            internal: true,
            executionContext: {
                type: LOG_TYPE[componentIdentifier.type],
                uid: componentIdentifier.uid,
                parentExecutionId,
             },
        });
    }

    let propertiesToWatch;
     /* wwFront:start */
    propertiesToWatch = [
        ...new Set(
            Object.values(librariesStore.components[baseUid]?.inner?.workflows || {})
                .filter(({ trigger }) => trigger === '_wwOnPropertyChange')
                .map(({ triggerProperty }) => triggerProperty)
        ),
    ];
    /* wwFront:end */

             for (const property of propertiesToWatch) {
                 const unwatch = watch(
                    () => context?.component?.props?.[property],
                    (newValue, oldValue) => {
                        triggerEvent('_wwOnPropertyChange', { newValue, oldValue }, property);
                    },
                    { immediate: true }
                );
             }
 
    return { triggerLibraryComponentEvent: triggerEvent, executeLibraryComponentWorkflow };
}

function setContentProperty(
    propertyName,
    propertyConfiguration,
    {
        component,
        currentStates,
        libraryComponentDataRef,
        useEditorKeyframesRef,
        context,
        content,
        rawContent,
        boundProps,
        layers,
     }
) {
    const rawProperty = computed(() => {
        const value = getComponentRawProperty({
            dataRef: component,
            prefix: 'content',
            suffix: propertyName,
            propertyConfiguration,
            statesRef: currentStates,
            libraryComponentDataRef,
            layers,
         });
        return value;
    });
    const property = computed(() => {
         /* wwFront:start */
        return getValue(rawProperty.value, context, {
            defaultUndefined: propertyConfiguration.fallbackToDefault
                ? propertyConfiguration.defaultValue
                : propertyConfiguration.defaultUndefined,
        });
        /* wwFront:end */
    });
    // eslint-disable-next-line vue/no-ref-as-operand
    content[propertyName] = property;
    rawContent[propertyName] = rawProperty;

 }
