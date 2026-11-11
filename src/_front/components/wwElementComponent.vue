/* eslint-disable vue/no-dupe-keys */
<template>
    <!-- wwFront:start -->
    <component
        :is="vueComponentName"
        v-if="isRendering && shouldRenderClientIslandContent"
        ref="component"
        :style="elementStyle"
        class="ww-element"
        :class="[state.class || '', ...styleClasses]"
        v-bind="componentAttributes"
        v-bind:[LAYOUT_ITEM_ATTRIBUTE]="wwLayoutItemAttribute"
        :content="content"
        :uid="uid"
        :ww-front-state="wwFrontState"
        :ww-element-state="wwElementState"
        ww-responsive="ww-element"
        @trigger-event="onTriggerEvent"
        @element-event="$emit('element-event', $event)"
        @add-state="addInternalState"
        @remove-state="removeInternalState"
        @toggle-state="toggleInternalState"
    >
        <slot></slot>
    </component>
    <!-- wwFront:end -->
 </template>

<script>
import { computed, ref, toRef, reactive, inject, provide, shallowRef, unref, watch, onUnmounted } from 'vue';

import {
    getComponentVueComponentName,
    getComponentConfiguration,
    getComponentLabel,
    getComponentIcon,
} from '@/_common/helpers/component/component';

 
import { useComponentData, useComponentTriggerEvent } from '@/_common/use/useComponent';
import { createElementClassName } from '@/_common/helpers/styleCompiler';
import { useComponentStates } from '@/_front/use/useComponentStates';
 import { useComponentAdvancedInteractions } from '@/_front/use/useComponentAdvancedInteractions';
import { useComponentActions } from '@/_common/use/useActions';
import { useElementLocalContext } from '@/_front/use/useElementLocalContext';
import { useStyleCompilerDynamicVariables } from '@/_front/use/useStyleCompilerDynamicVariables';
import { getStyleAtomicClassesForSource } from '@/_front/services/styleCompilerAtomicClasses';
import { consumeLayoutItemStyle, useLayoutItemAttribute, useLayoutItemIndex } from '@/_front/use/useLayoutItemMarker';
import { LAYOUT_ITEM_ATTRIBUTE } from '@/_common/helpers/styleCompiler/layoutContract';
import { createComponentId } from '@/_front/services/componentIds';
import { getElementStyleResetClasses } from '@/_front/helpers/elementStyleReset';
import { useClientIslandRendering } from '@/_front/rendering/useClientIslandRendering';

function mergeStateAttributes(...values) {
    const states = new Set();

    for (const value of values) {
        if (typeof value !== 'string') continue;

        for (const state of value.split(/\s+/)) {
            if (state) states.add(state);
        }
    }

    return states.size ? [...states].join(' ') : null;
}

export default {
    components: {
     },
    inject: {
        parentId: { from: '_wwElementUid', default: null },
    },
    inheritAttrs: false,
    props: {
        uid: { type: String, required: true },
        isWwObject: { type: Boolean, default: true }, // only here to not have warning on vbind
        wwProps: { type: Object, default: () => ({}) },
        states: { type: Array, default: () => [] },
        isLibraryComponentRoot: { type: Boolean, default: false },
        libraryComponentData: { type: Object, default: null },
        libraryComponentTriggerEvent: { type: Function, default: null },
        libraryComponentTriggerLibraryComponentEvent: { type: Function, default: null },
        libraryComponentRuntimeStyleSourceUid: { type: String, default: null },
        libraryComponentRuntimeStyleContext: { type: Object, default: null },
        extraStyle: { type: Object, default: null },
     },
    // update:child-selected and update:is-selected are used by useElementSelection
    emits: ['element-event', 'update:child-selected', 'update:is-selected', 'add-state', 'remove-state'],
    setup(props, vueContext) {
        const id = createComponentId();
        const component = shallowRef(null);

        const wwLayoutContext = inject('wwLayoutContext', {});
        const wwLayoutIndex = useLayoutItemIndex();
        const wwLayoutItemAttribute = useLayoutItemAttribute(wwLayoutIndex);
        const wwLayoutItemStyle = consumeLayoutItemStyle();
        const bindingContext = inject('bindingContext', null);
        const sectionId = inject('sectionId', null);
        const isDragPreview = inject('_wwIsDragPreview', false);
        const wwLibraryComponentUid_ = inject('wwLibraryComponentUid_', null);
        const componentDataRef = computed(() => wwLib.store.websiteData.wwObjects?.[props.uid]);
        const styleSourceId = computed(() => componentDataRef.value?._si);

        provide('wwLayoutContext', {});
        provide('_wwElementUid', props.uid);
        provide('_wwElementComponentId', id);
        provide('_wwElementStyleSourceId', styleSourceId);

 
        const libraryComponentContext = inject('_wwLibraryComponentContext', null);
        const dropzoneContext = inject('_wwDropzoneContext', null);
        const localContext = useElementLocalContext();
        const context = reactive({
            item: computed(() => bindingContext || {}),
            layout: computed(() => ({ id: wwLayoutContext.layoutId })),
            component: libraryComponentContext?.component,
            get thisInstance() {
                return component.value?.$el;
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
            toggleInternalState,
         } = useComponentStates(
            { uid: props.uid, type: 'element' },
            {
                context,
                propsState: toRef(props, 'states'),
             }
        );

        provide('wwAddInternalState', addInternalState);
        provide('wwRemoveInternalState', removeInternalState);
        provide('wwToggleInternalState', toggleInternalState);

        const {
            content,
            state,
            rawContent,
            name: elementName,
            configuration,
            isRendering,
         } = useComponentData({
            type: 'element',
            uid: props.uid,
            componentId: id,
            currentStates,
            wwProps: toRef(props, 'wwProps'),
            context,
            libraryComponentDataRef: computed(() => props.libraryComponentData),
         });
 
        const styleClasses = computed(() => [
            createElementClassName(props.uid, styleSourceId.value),
            ...getStyleAtomicClassesForSource(props.uid, 'element'),
            ...getElementStyleResetClasses(getComponentConfiguration('element', props.uid)),
        ]);

        // TODO: could be one common reactive property
        // This is already the case for Section
        const wwFrontState = reactive({
            lang: computed(() => wwLib.store.front.lang),
            pageId: computed(() => wwLib.store.websiteData.pageId),
            sectionId, // THIS IS WRONG, SHOULD NOT BE HERE. PLEASE DELETE ONE DAY :(
            screenSize: computed(() => wwLib.store.front.activeScreenSize),
            screenSizes: computed(() => wwLib.store.front.screenSizes),
        });
        provide('wwFrontState', wwFrontState);

        const hasLink = computed(() => {
            return (
                state.link &&
                typeof state.link === 'object' &&
                Object.keys(state.link).length &&
                state.link.type !== 'none'
            );
        });

        const wwElementState = reactive({
            props: toRef(props, 'wwProps'),
            uid: props.uid,
            name: elementName,
            states: currentStates,
        });
        provide('wwElementState', wwElementState);

        // When component is unmount, we reset state (the mouse leave event is not fired)
        watch(isRendering, isRendering => {
            if (!isRendering) {
                removeInternalState('_wwHover', true);
            }
        });

 
        function triggerElementEvent(event) {
            vueContext.emit('element-event', event);
        }
        provide('triggerElementEvent', triggerElementEvent);

 
        if (!isDragPreview) {
            useComponentAdvancedInteractions(state, wwLib.store.websiteData.pageId);
        }

 
 
        if (!isDragPreview) {
            useComponentActions(
                { uid: props.uid, componentId: id, type: 'element', repeatIndex: bindingContext?.index },
                { context, configuration, componentRef: component }
            );
        }

        const { listeners, triggerEvent } = useComponentTriggerEvent(
            {
                state,
                componentIdentifier: { type: 'element', componentId: id, uid: props.uid },
                triggerParentEvent: props.libraryComponentTriggerEvent,
                triggerLibraryComponentEvent: props.libraryComponentTriggerLibraryComponentEvent,
                parentInteractionsRef: computed(() => props.libraryComponentData?.state?.interactions),
                isRenderingRef: isRendering,
                rootElementRef: component,
                extraListeners: {
                    onMouseenter() {
                        addInternalState('_wwHover', true);
                        vueContext.emit('add-state', ['_wwHover', true]);
                    },
                    onMouseleave() {
                        removeInternalState('_wwHover', true);
                        vueContext.emit('remove-state', ['_wwHover', true]);
                    },
                },
                isRuntimePreview: isDragPreview,
            },
            context
        );

        const wwTechnicalAttributes = computed(() => {
            let attributes = {
                'data-ww-element': !props.noInteraction,
                'data-ww-uid': props.uid,
                'data-ww-component-id': id,
            };

            if (bindingContext?.index != null) attributes['data-ww-repeat-index'] = bindingContext?.index;

            if (wwLibraryComponentUid_) attributes['data-ww-comp-uid'] = wwLibraryComponentUid_;

 
            return attributes;
        });

        // TODO if we are not recalculate this too often? even if it is static
        // The function is call in different places in the setup functions
        const config = getComponentConfiguration('element', props.uid);
        const vueComponentName = getComponentVueComponentName('element', props.uid);
        const shouldRenderClientIslandContent = useClientIslandRendering({
            type: 'element',
            uid: props.uid,
            componentName: vueComponentName,
            forceClientOnly: () => config?.staticRendering === false,
        });
        const renderedRuntimeComponentId = computed(() =>
            isRendering.value && unref(shouldRenderClientIslandContent) ? id : undefined
        );

        useStyleCompilerDynamicVariables({
            sourceUid: toRef(props, 'uid'),
            context,
            targets: { element: component },
            targetIds: { element: renderedRuntimeComponentId },
        });
        if (props.libraryComponentRuntimeStyleSourceUid) {
            useStyleCompilerDynamicVariables({
                sourceUid: toRef(props, 'libraryComponentRuntimeStyleSourceUid'),
                context: props.libraryComponentRuntimeStyleContext || {},
                targets: { element: component },
                targetIds: { element: renderedRuntimeComponentId },
            });
        }

        return {
            component,
            content,
            state,
            componentId: id,
            sectionId,
            configuration: config,
            vueComponentName,
            shouldRenderClientIslandContent,
            bindingContext,
            rawContent,
             context,
            elementName,
            addInternalState,
            removeInternalState,
            toggleInternalState,
            listeners,
            triggerEvent,
            wwFrontState,
            hasLink,
            wwElementState,
            isRendering,
            wwLibraryComponentUid_,
            styleClasses,
            wwTechnicalAttributes,
            currentStatesAttribute,
            forcedStatesAttribute,
            wwLayoutIndex,
            wwLayoutItemAttribute,
            wwLayoutItemStyle,
            LAYOUT_ITEM_ATTRIBUTE,
         };
    },
    computed: {
        /*=============================================m_ÔÔ_m=============================================\
            CONFIG / STATE
        \================================================================================================*/
        componentAttributes() {
            let attributes = { ...this.$attrs };

            // Sometimes components can have listeners in $attrs, we need to merge them
            for (const [eventName, listener] of Object.entries(this.listeners)) {
                const tmp = attributes[eventName];
                attributes[eventName] = event => {
                    listener(event);
                    tmp?.(event);
                };
            }

            if (this.state.attributes) {
                try {
                    for (const attr of this.state.attributes.filter(attr => attr.name)) {
                        attributes[attr.name.replace(/ /g, '')] = attr.value;
                    }
                } catch {
                    wwLib.wwLog.warn(
                        `Attributes is missbind for element ${getComponentLabel('element', this.uid)} (${this.uid})`
                    );
                }
            }

            if (this.state.id) {
                attributes.id = this.state.id;
            }

            Object.assign(attributes, this.wwTechnicalAttributes);
            attributes['data-ww-states'] = mergeStateAttributes(
                attributes['data-ww-states'],
                this.currentStatesAttribute
            );
            attributes['data-ww-forced-states'] = mergeStateAttributes(
                attributes['data-ww-forced-states'],
                this.forcedStatesAttribute
            );

            return attributes;
        },
 
        /*=============================================m_ÔÔ_m=============================================\
            STYLE
        \================================================================================================*/
        elementStyle() {
            // Authored styles are rendered by the compiler. The consumed layout-item style makes the
            // runtime contract independent from slot forwarding; explicit extraStyle remains compatible
            // with older/custom layout adapters and wins when both paths are present.
             /* wwFront:start */
            // eslint-disable-next-line no-unreachable
            return { ...(this.wwLayoutItemStyle || {}), ...(this.extraStyle || {}) };
            /* wwFront:end */
        },
 
        /*=============================================m_ÔÔ_m=============================================\
            STYLE HELPERS
        \================================================================================================*/
     },
    methods: {
        onTriggerEvent({ name, event } = {}) {
            this.triggerEvent(name, event);
        },
     },
};
</script>

<style scoped lang="scss">
 </style>
