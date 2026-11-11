<template>
     <!-- wwFront:start -->
    <wwElementComponent
        v-if="!isLoop"
        :key="rootUid"
        ref="elementComponent"
        :uid="rootUid"
        is-library-component-root
        :class="[instanceStyleClass, ...instanceAtomicStyleClasses]"
        :library-component-data="componentData"
        :library-component-runtime-style-source-uid="uid"
        :library-component-runtime-style-context="runtimeStyleContext"
        :library-component-trigger-event="triggerEvent"
        :library-component-trigger-library-component-event="triggerLibraryComponentEvent"
        v-bind="$attrs"
        :data-ww-states="currentStatesAttribute"
        :data-ww-forced-states="forcedStatesAttribute"
        @addState="addInternalState(...$event)"
        @removeState="removeInternalState(...$event)"
    ></wwElementComponent>
    <!-- wwFront:end -->
</template>

<script>
import { ref, inject, provide, computed, reactive, onBeforeUnmount, toRef } from 'vue';
import { getComponentBaseUid } from '@/_common/helpers/component/component.js';
 import wwElementComponent from '@/_front/components/wwElementComponent.vue';
import { useComponentData, useComponentTriggerEvent, useLibraryComponentWorkflow } from '@/_common/use/useComponent.js';
import {
    createLibraryComponentLayoutData,
    createLibraryComponentRenderingData,
} from '@/_common/helpers/component/libraryComponentRendering';
import { createElementClassName } from '@/_common/helpers/styleCompiler';
import { useInner } from '@/_front/use/useInner.js';
import { useComponentStates } from '@/_front/use/useComponentStates.js';
import { useLibraryComponentActions } from '@/_common/use/useActions.js';
import { getStyleAtomicClassesForSource } from '@/_front/services/styleCompilerAtomicClasses';
import { provideLibraryComponentLayoutStyleScope } from '@/_front/use/useLayoutStyleScopes';

let componentId = 1;

export default {
    components: {
         wwElementComponent,
    },
    inheritAttrs: false,
    props: {
        uid: { type: String, required: true },
        isPopup: { type: Boolean, default: false },
    },
    setup(props) {
        const id = componentId;
        const baseUid = getComponentBaseUid('libraryComponent', props.uid);
        componentId++;

        const wwLayoutContext = inject('wwLayoutContext', {});
        const bindingContext = inject('bindingContext', null);
        const isDragPreview = inject('_wwIsDragPreview', false);
        const isACopy = computed(() => bindingContext && bindingContext.isACopy);
        const modalsStore = wwLib.store.popups;
        const componentDataRef = computed(
            () => wwLib.store.websiteData.wwObjects?.[props.uid] || modalsStore.instances?.[props.uid]
        );
        const styleSourceId = computed(() => componentDataRef.value?._si);

        provide('wwLibraryComponentUid_', props.uid);
        provideLibraryComponentLayoutStyleScope(toRef(props, 'uid'), styleSourceId);

 
        const elementComponent = ref(null);
        const parentLibraryComponentContext = inject('_wwLibraryComponentContext', null);
        const dropzoneContext = inject('_wwDropzoneContext', null);
        const localContext = inject('_wwLocalContext', null);
        const context = reactive({
            item: computed(() => bindingContext || {}),
            layout: computed(() => ({ id: wwLayoutContext.layoutId })),
            component: parentLibraryComponentContext?.component,
            get thisInstance() {
                return elementComponent.value?.component?.$el;
            },
            dropzone: dropzoneContext,
            local: localContext,
        });

        const {
            currentStates,
            currentStatesAttribute,
            forcedStatesAttribute,
            addInternalState,
            removeInternalState,
         } = useComponentStates(
            { uid: props.uid, type: 'element' },
            {
                context,
             }
        );

        const {
            content,
            state,
            rawContent,
            rawState,
            name: elementName,
            componentConditionalRendering,
            rawConditionalRendering,
            componentLayoutRuntime,
         } = useComponentData({
            type: 'libraryComponent',
            uid: props.uid,
            componentId: id,
            currentStates,
            context,
         });

        const instanceStyleClass = computed(() => createElementClassName(props.uid, styleSourceId.value));
        const instanceAtomicStyleClasses = computed(() => getStyleAtomicClassesForSource(props.uid, 'element'));

 
        const { variables, updateVariable, formulas, componentVariablesConfiguration } = useInner(
            baseUid,
            {
                context,
                props: content,
            },
            { uid: props.uid, componentId: id, type: 'element' }
        );
        const libraryComponentContext = {
            component: {
                props: content,
                baseUid,
                variables,
                workflowsResults: reactive({}),
                 localComponentActionsFn: reactive({
                    elements: {},
                    libraryComponents: {},
                }),
                methods: {
                    updateVariable,
                },
                formulas,
                componentVariablesConfiguration,
            },
            get thisInstance() {
                return elementComponent.value?.component?.$el;
            },
        };

        // Triggering workflows define on the component level
        const { triggerLibraryComponentEvent, executeLibraryComponentWorkflow } = useLibraryComponentWorkflow(
            {
                baseUid,
                componentIdentifier: { type: 'libraryComponent', componentId: id, uid: props.uid },
                isRuntimePreview: isDragPreview,
            },
            libraryComponentContext
        );
        libraryComponentContext.component.methods.executeWorkflow = executeLibraryComponentWorkflow;

        // Triggering workflows define on the instance level
        const { triggerEvent } = useComponentTriggerEvent(
            {
                state,
                componentIdentifier: { type: 'libraryComponent', componentId: id, uid: props.uid },
                isRuntimePreview: isDragPreview,
            },
            context
        );
        libraryComponentContext.component.methods.triggerEvent = triggerEvent;

        const parentCounts = inject('_wwLibraryComponentCounts', ref({}));
        const counts = computed(() => ({
            ...parentCounts.value,
            [baseUid]: (parentCounts.value[baseUid] || 0) + 1,
        }));
        provide('_wwLibraryComponentCounts', counts);

        // Saving data to be restored for dropzones
        const parentLibraryComponentLayers = inject('_wwLibraryComponentLayers', {});
        const layers = {
            ...parentLibraryComponentLayers,
            [baseUid]: {
                componentIdentifier: { type: 'libraryComponent', componentId: id, uid: props.uid, baseUid },
                savedContext: {
                    bindingContext,
                    libraryComponentContext: parentLibraryComponentContext,
                    dropzoneContext,
                    localContext,
                 },
                childrenData: computed(() => content?.childrenData || {}),
            },
        };
        provide('_wwLibraryComponentLayers', layers);

 
        if (!isDragPreview) {
            useLibraryComponentActions(
                { uid: props.uid, componentId: id, repeatIndex: bindingContext?.index },
                { context, executionContext: libraryComponentContext }
            );
        }

        // Resetting data context
        provide('bindingContext', null);
        provide('_wwLibraryComponentContext', libraryComponentContext);

 
        if (props.isPopup && !isDragPreview) {
            onBeforeUnmount(() => {
                triggerLibraryComponentEvent('_wwClosePopup');
            });
        }

        return {
            addInternalState,
            removeInternalState,
            isLoop: computed(() => counts.value[baseUid] > 10),
            triggerEvent,
            triggerLibraryComponentEvent,
            instanceStyleClass,
            instanceAtomicStyleClasses,
            currentStatesAttribute,
            forcedStatesAttribute,
            componentData: reactive({
                state,
                rawState,
                ...createLibraryComponentRenderingData({
                    raw: rawConditionalRendering,
                    value: componentConditionalRendering,
                }),
                ...createLibraryComponentLayoutData({
                    display: {
                        raw: componentLayoutRuntime.rawDisplay,
                        value: componentLayoutRuntime.displayValue,
                    },
                    textAlign: {
                        raw: componentLayoutRuntime.rawTextAlign,
                        value: componentLayoutRuntime.textAlign,
                    },
                }),
             }),
            modalsStore,
            elementComponent,
            runtimeStyleContext: context,
         };
    },
    computed: {
        base() {
            const baseUid = getComponentBaseUid('libraryComponent', this.uid);
            return wwLib.store.libraries.components[baseUid];
        },
        rootUid() {
            return this.base?.rootElementId;
        },
    },
};
</script>

 