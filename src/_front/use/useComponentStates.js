import { ref, reactive, computed, unref, provide, inject, watch } from 'vue';
import { getValue } from '@/_common/helpers/code/customCode.js';

const ACTIVE_STATES_KEY = Symbol.for('weweb.activeStates');
const FORCED_STATES_KEY = Symbol.for('weweb.forcedStates');

export function useComponentStates({ uid, type }, { context = {}, propsState = [], isSelected = false }) {
    // State define by the user on this component
    const rawStates = computed(() => wwLib.store.websiteData.resolveComponentStates({ uid, type }));

    // Store state handle by weweb like _wwHover/ _wwLinkActive
    const internalStates = reactive(new Set());

    const activeStates = computed(() => {
        return rawStates.value.filter(state => getValue(state.condition, context)).map(({ id }) => id);
    });
    const parentActiveStates = inject(ACTIVE_STATES_KEY, ref([]));
    const parentForcedStates = inject(FORCED_STATES_KEY, ref([]));

    const lazyCurrentStates = ref([]);
    const lazyRuntimeStates = ref([]);
    const lazyForcedStates = ref([]);
    watch(
        () => {
            const runtimeStates = getMatchingRawStateIds(rawStates.value, state => {
                return (
                    internalStates.has(state.id) ||
                    internalStates.has(state.label) ||
                    (unref(propsState) || []).includes(state.label) ||
                    activeStates.value.includes(state.id) ||
                    parentActiveStates.value.includes(state.id)
                );
            });
            const inheritedForcedStates = getMatchingRawStateIds(rawStates.value, state =>
                parentForcedStates.value.includes(state.id)
            );
            let forcedStates = inheritedForcedStates;

 
            return {
                states: mergeStates(runtimeStates, forcedStates),
                runtimeStates,
                forcedStates,
            };
        },
        ({ states, runtimeStates, forcedStates }) => {
            // This is working because order is always the same
            if (JSON.stringify(states) !== JSON.stringify(lazyCurrentStates.value)) {
                lazyCurrentStates.value = states;
            }
            if (JSON.stringify(runtimeStates) !== JSON.stringify(lazyRuntimeStates.value)) {
                lazyRuntimeStates.value = runtimeStates;
            }
            if (JSON.stringify(forcedStates) !== JSON.stringify(lazyForcedStates.value)) {
                lazyForcedStates.value = forcedStates;
            }
        },
        { immediate: true }
    );

 
    // Lazy is important, or all children will be recalculate for nothing
    const lazyProvidedStates = ref([]);
    watch(
        () => {
            const inheritStates = lazyRuntimeStates.value.filter(state => state.startsWith('_wwParent_'));
            const inheritableStates = rawStates.value
                .filter(state => lazyRuntimeStates.value.includes(state.id))
                .map(state => `_wwParent_${uid}_${state.id}`);

            return [...inheritStates, ...inheritableStates, ...parentActiveStates.value];
        },
        states => {
            // This is working because order is always the same
            if (JSON.stringify(states) !== JSON.stringify(lazyProvidedStates.value)) {
                lazyProvidedStates.value = states;
            }
        },
        { immediate: true }
    );

    const lazyProvidedForcedStates = ref([]);
    watch(
        () => {
            const inheritForcedStates = lazyForcedStates.value.filter(state => state.startsWith('_wwParent_'));
            const inheritableForcedStates = rawStates.value
                .filter(state => lazyForcedStates.value.includes(state.id))
                .map(state => `_wwParent_${uid}_${state.id}`);

            return [...inheritForcedStates, ...inheritableForcedStates, ...parentForcedStates.value];
        },
        states => {
            // This is working because order is always the same
            if (JSON.stringify(states) !== JSON.stringify(lazyProvidedForcedStates.value)) {
                lazyProvidedForcedStates.value = states;
            }
        },
        { immediate: true }
    );

    provide(ACTIVE_STATES_KEY, lazyProvidedStates);
    provide(FORCED_STATES_KEY, lazyProvidedForcedStates);

    return {
        currentStates: lazyCurrentStates,
        forcedStates: lazyForcedStates,
        currentStatesAttribute: computed(() => formatStateAttribute(lazyRuntimeStates.value)),
        forcedStatesAttribute: computed(() => formatStateAttribute(lazyForcedStates.value)),
         addInternalState(state, disabledOnEdit) {
             internalStates.add(state);
        },
        removeInternalState(state, disabledOnEdit) {
             internalStates.delete(state);
        },
        toggleInternalState(state, disabledOnEdit) {
             if (internalStates.has(state)) {
                internalStates.delete(state);
            } else {
                internalStates.add(state);
            }
        },
    };
}

function formatStateAttribute(states) {
    return states.length ? states.join(' ') : null;
}

function getMatchingRawStateIds(states, predicate) {
    return states.filter(predicate).map(state => state.id);
}

function mergeStates(...stateLists) {
    return [...new Set(stateLists.flat())];
}
