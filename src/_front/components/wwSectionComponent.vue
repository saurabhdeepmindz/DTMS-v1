/* eslint-disable vue/no-dupe-keys */
<template>
    <div
        v-if="isRendering"
        ref="rootElement"
        ww-responsive="ww-section"
        class="ww-section"
        :data-section-uid="uid"
        :data-ww-states="currentStatesAttribute"
        :data-ww-forced-states="forcedStatesAttribute"
        :data-ww-component-id="sectionContainerComponentId"
        :class="[
             sectionStyleClass,
            ...sectionContainerAtomicStyleClasses,
        ]"
        @mouseenter="onMouseEnter"
        @mouseleave="onMouseLeave"
    >
        <!-- BACKGROUND VIDEO -->
        <wwBackgroundVideo v-if="backgroundVideo" :video="backgroundVideo"></wwBackgroundVideo>

        <div :id="anchorId" class="hash-anchor"></div>

         <!-- wwFront:start -->
        <component
            :is="vueComponentName"
            v-if="shouldRenderClientIslandContent"
            ref="component"
            class="ww-section-element"
            :class="[state.class || '', ...sectionElementAtomicStyleClasses]"
            v-bind="componentAttributes"
            ww-responsive="ww-section-element"
            :data-ww-states="currentStatesAttribute"
            :data-ww-forced-states="forcedStatesAttribute"
            :data-ww-component-id="sectionElementComponentId"
            :content="content"
            :uid="uid"
            :ww-section-state="wwSectionState"
            :ww-front-state="wwFrontState"
            @trigger-event="onTriggerEvent"
            @add-state="addInternalState"
            @remove-state="removeInternalState"
            @toggle-state="toggleInternalState"
        />
        <!-- wwFront:end -->

     </div>
</template>

<script>
 import { provide, ref, computed, toRef, reactive, inject, shallowRef, unref, watch } from 'vue';

import {
    getComponentIcon,
    getComponentLabel,
    getComponentVueComponentName,
} from '@/_common/helpers/component/component';
import { useComponentData, useComponentTriggerEvent } from '@/_common/use/useComponent';
import { useComponentStates } from '@/_front/use/useComponentStates';
import { useComponentAdvancedInteractions } from '@/_front/use/useComponentAdvancedInteractions';
import { useComponentActions } from '@/_common/use/useActions';
import { useStyleCompilerDynamicVariables } from '@/_front/use/useStyleCompilerDynamicVariables';
import { getStyleAtomicClassesForSource } from '@/_front/services/styleCompilerAtomicClasses';
import { createComponentId } from '@/_front/services/componentIds';
import { useClientIslandRendering } from '@/_front/rendering/useClientIslandRendering';
import { createSectionClassName } from '@/_common/helpers/styleCompiler';

 
import { inheritFrom } from '@/_common/helpers/configuration/configuration';

export default {
    name: 'wwSectionComponent',
    components: {
     },
    props: {
        uid: { type: String, required: true },
        index: { type: Number, required: true },
    },
    setup(props) {
        const component = shallowRef(null);
        const rootElement = shallowRef(null);
        const sectionContainerComponentId = createComponentId();
        const sectionElementComponentId = createComponentId();
        provide('sectionId', props.uid);
        provide('dragZoneId', props.uid);

 
        const {
            currentStates,
            currentStatesAttribute,
            forcedStatesAttribute,
            addInternalState,
            removeInternalState,
            toggleInternalState,
        } = useComponentStates(
            { uid: props.uid, type: 'section' },
            {
                context: {},
                propsState: toRef(props, 'states'),
             }
        );

        const {
            content,
            state,
            configuration,
            name: sectionName,
            isRendering,
         } = useComponentData({
            type: 'section',
            uid: props.uid,
            currentStates,
         });
        const vueComponentName = getComponentVueComponentName('section', props.uid);
        const shouldRenderClientIslandContent = useClientIslandRendering({
            type: 'section',
            uid: props.uid,
            componentName: vueComponentName,
            forceClientOnly: () => configuration?.staticRendering === false,
        });

        useStyleCompilerDynamicVariables({
            sourceUid: toRef(props, 'uid'),
            targets: {
                sectionContainer: rootElement,
                sectionElement: component,
            },
            targetIds: {
                sectionContainer: computed(() => (isRendering.value ? sectionContainerComponentId : undefined)),
                sectionElement: computed(() =>
                    isRendering.value && unref(shouldRenderClientIslandContent) ? sectionElementComponentId : undefined
                ),
            },
        });
        const sectionContainerAtomicStyleClasses = computed(() =>
            getStyleAtomicClassesForSource(props.uid, 'section-container')
        );
        const sectionElementAtomicStyleClasses = computed(() =>
            getStyleAtomicClassesForSource(props.uid, 'section-element')
        );

        // When component is unmount, we reset state (the mouse leave event is not fired)
        watch(isRendering, isRendering => {
            if (!isRendering) {
                removeInternalState('_wwHover', true);
            }
        });

        const { listeners, triggerEvent } = useComponentTriggerEvent({
            state,
            componentIdentifier: { type: 'section', uid: props.uid },
            isRenderingRef: isRendering,
        });

        const wwSectionState = reactive({
            uid: props.uid, // this can be static
            name: sectionName,
            states: currentStates,
        });

 
        useComponentAdvancedInteractions(state, wwLib.store.websiteData.pageId);
        useComponentActions({ uid: props.uid, type: 'section' }, { configuration, componentRef: component });

 
        return {
            rootElement,
            component,
            sectionContainerComponentId,
            sectionElementComponentId,
            sectionStyleClass: computed(() =>
                createSectionClassName(props.uid, wwLib.store.websiteData.sections?.[props.uid]?._si)
            ),
            sectionContainerAtomicStyleClasses,
            sectionElementAtomicStyleClasses,
            shouldRenderClientIslandContent,
            content,
            state,
            configuration,
            listeners,
            triggerEvent,
            currentStatesAttribute,
            forcedStatesAttribute,
            addInternalState,
            removeInternalState,
            toggleInternalState,
            vueComponentName, // this can never change, as this component is uid keyed and objectbase cannot change
            wwSectionState,
            wwFrontState: inject('wwFrontState'),
            anchorId: computed(() => {
                const { sectionTitle } = wwLib.store.websiteData.sections[props.uid] || {};
                return wwLib.wwUtils.sanitize(sectionTitle);
            }),
            isRendering,
         };
    },
    computed: {
        backgroundVideo() {
            if (!inheritFrom(this.configuration, 'ww-background-video') || !this.content['_ww-backgroundVideo'])
                return null;
            return {
                url: this.content['_ww-backgroundVideo'],
                loop: this.content['_ww-backgroundVideoLoop'],
                poster: this.content['_ww-backgroundVideoPoster'],
                preload: this.content['_ww-backgroundVideoPreload'],
                size: this.content['_ww-backgroundVideoSize'],
            };
        },
        componentAttributes() {
            let attributes = { ...this.listeners };

            if (this.state.attributes) {
                try {
                    for (const attr of this.state.attributes.filter(attr => attr.name)) {
                        attributes[attr.name.replace(/ /g, '')] = attr.value;
                    }
                } catch {
                    wwLib.wwLog.warn(
                        `Attributes is missbind for section ${getComponentLabel('section', this.uid)} (${this.uid})`
                    );
                }
            }

            if (this.state.id) {
                attributes.id = this.state.id;
            }

            return attributes;
        },
     },
    methods: {
        onTriggerEvent({ name, event } = {}) {
            this.triggerEvent(name, event);
        },
        onMouseEnter() {
            this.addInternalState('_wwHover', true);
        },
        onMouseLeave() {
            this.removeInternalState('_wwHover', true);
        },
     },
};
</script>

<style lang="scss" scoped>
@layer ww-style-core {
    .ww-section {
        position: relative;
        max-width: auto;
        display: flex;
        flex-direction: column;
        align-items: center;

        .ww-section-element {
            width: 100%;
            // min-height: 50px;
        }

        .hash-anchor {
            position: absolute;
            top: 0;
            left: 50%;
        }
    }
}

 </style>
