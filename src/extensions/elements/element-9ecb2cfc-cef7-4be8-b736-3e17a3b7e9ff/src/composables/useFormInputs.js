import { omit } from 'lodash-es';
import { computed, watch, provide, ref } from 'vue';

export function useFormInputs({ updateInputValidity, removeInputValidity, validationType }) {
    const inputsMap = ref({});

    const formInputs = computed(() => {
        return Object.fromEntries(
            Array.from(Object.values(inputsMap.value))
                .filter(input => input && typeof input === 'object')
                .map(input => Object.entries(input)[0])
                .filter(([key, value]) => key !== 'null' && value !== null)
                .map(([key, value]) => [
                    key,
                    omit(value, ['forceValidateField', 'updateValue', 'cancelValidation', 'pending', 'initialValue', 'initialIsValid']),
                ])
        );
    });

    function registerInput(id, input) {
        inputsMap.value[id] = input;
        const [, value] = Object.entries(input)[0];
        updateInputValidity(id, value.isValid ?? null);
    }

    function updateInput(id, updateFn) {
        const input = inputsMap.value[id];
        if (!input) return;
        updateFn(input);
        const newIsValid = Object.values(inputsMap.value[id])?.[0]?.isValid ?? null;
        updateInputValidity(id, newIsValid);
    }

    function unregisterInput(id) {
        delete inputsMap.value[id];
        removeInputValidity(id);
    }

    watch(
        inputsMap,
        () => {
            for (const [id, input] of Object.entries(inputsMap.value)) {
                const [, value] = Object.entries(input)[0];
                if ('isValid' in value) updateInputValidity(id, value.isValid);
            }
        },
        { deep: true, immediate: true }
    );

    provide('_wwForm:registerInput', registerInput);
    provide('_wwForm:unregisterInput', unregisterInput);
    provide('_wwForm:updateInput', updateInput);

    function forceValidateAllFields() {
        const validityMap = {};
        const invalidFields = [];

        for (const [id, inputs] of Object.entries(inputsMap.value)) {
            for (const [name, input] of Object.entries(inputs)) {
                if ('forceValidateField' in input) {
                    const isValid = input.forceValidateField();
                    validityMap[id + name] = isValid;

                    if (!isValid) {
                        invalidFields.push({
                            id: id,
                            name: name,
                            value: input.value,
                            isValid: isValid,
                            error: input.error || input.validationMessage || 'Validation failed',
                        });
                    }
                }
            }
        }

        const isValid = Object.values(validityMap).every(Boolean);

        return {
            isValid,
            invalidFields,
            validityMap,
        };
    }

    function resetInputs(initialValues = {}) {
        initialValues ||= {};

        for (const [id, inputs] of Object.entries(inputsMap.value)) {
            for (const [name, input] of Object.entries(inputs)) {
                if (input && typeof input === 'object') {
                    updateInput(id, input => {
                        if (input[name]) {
                            // Determine reset value and whether it's a forced value
                            let newValue;
                            let isForcedValue = false;

                            if (initialValues[name] !== undefined) {
                                newValue = initialValues[name];
                                isForcedValue = true;
                            } else if (input[name].initialValue !== undefined) {
                                newValue = input[name].initialValue;
                            } else {
                                // Default empty value based on type
                                if (Array.isArray(input[name].value)) {
                                    newValue = [];
                                } else if (typeof input[name].value === 'object' && input[name].value !== null) {
                                    newValue = {};
                                } else if (typeof input[name].value === 'boolean') {
                                    newValue = false;
                                } else if (typeof input[name].value === 'number') {
                                    newValue = 0;
                                } else {
                                    newValue = '';
                                }
                            }

                            // Update value
                            input[name].value = newValue;
                            if (input[name].updateValue) {
                                input[name].updateValue(newValue);
                            }

                            // In submit mode, never trigger validation on reset (even for forced values)
                            // In change mode, allow validation for forced values only
                            const isSubmitMode = validationType?.value === 'submit';
                            const shouldResetValidation = isSubmitMode || !isForcedValue;

                            if (shouldResetValidation) {
                                // Reset validation state to initial state AFTER value update
                                // This ensures we overwrite any validation triggered by the value change
                                input[name].isValid = input[name].initialIsValid ?? null;
                                input[name].pending = false;

                                // Cancel any pending validation in the next tick
                                // This ensures we cancel validations that were queued by watchers during this tick
                                setTimeout(() => {
                                    if (input[name]?.cancelValidation) {
                                        input[name].cancelValidation();
                                    }
                                }, 0);
                            }
                            // For forced values in change mode, let the validation watcher run naturally
                        }
                    });

                    // Note: updateInput already calls updateInputValidity, so we don't need to call it again here
                }
            }
        }
    }

    return {
        inputsMap,
        formInputs,
        updateInput,
        forceValidateAllFields,
        resetInputs,
    };
}
