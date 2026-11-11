export function useFormSubmission({ emit, forceValidateAllFields, formInputs, formName }) {
    const handleSubmit = async event => {
        try {

            const validationResult = forceValidateAllFields();
            
            if (!validationResult.isValid) {
                const invalidFields = validationResult.invalidFields;
                const fieldNames = invalidFields.map(f => f.name).join(', ');
                


                emit('trigger-event', { name: 'submit-validation-error', event });
            } else {
                const formData = Object.fromEntries(
                    Object.entries(formInputs?.value || {}).map(([key, input]) => [key, input.value])
                );


                emit('trigger-event', { name: 'submit', event });
            }
        } catch (error) {
            console.error('Form submission error', error);
        }
    };

    return { handleSubmit };
}
