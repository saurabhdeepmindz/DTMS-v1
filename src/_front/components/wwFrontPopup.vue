<template>
    <wwLocalContext :methods="localMethods" :data="data" element-key="popup">
        <wwLibraryComponent :uid="modal.uid" is-popup></wwLibraryComponent>
    </wwLocalContext>
</template>

<script>
import { provide, computed } from 'vue';
import wwLibraryComponent from './wwLibraryComponent.vue';

export default {
    name: 'wwFrontPopup',
    components: { wwLibraryComponent },
    props: {
        modal: {
            type: Object,
            required: true,
        },
        stacked: { type: Boolean, default: false },
    },
    setup(props) {
        const popupStore = wwLib.store.popups;
        const localMethods = {
            close: {
                description: 'Close the popup',
                method(data) {
                    popupStore.close(props.modal?.uid, data);
                },
                editor: {
                    label: 'Close this popup instance',
                    group: 'Popup',
                    icon: 'popup',
                    args: [
                        {
                            name: 'data',
                            type: 'any',
                            description: 'Data to return to the caller',
                            required: false,
                        },
                    ],
                    aiMetadata: {
                        description: 'Close the popup',
                        schema: {
                            args: {
                                type: 'array',
                                description:
                                    'Array of length 1, containing the data of any type to return to the caller. Only the content of the first element is bindable.',
                                bindable: false,
                            },
                        },
                        utilsFunctionMatch: 'utilsFunctions.closePopup(context, args[0])',
                    },
                },
            },
        };
        const data = computed(() => {
            const instances = Object.values(popupStore.instances).filter(
                m => m.libraryComponentBaseId === props.modal?.libraryComponentBaseId
            );
            return {
                instancesCount: instances.length,
                index: instances.findIndex(m => m.uid === props.modal?.uid),
                totalCount: Object.keys(popupStore.instances).length,
            };
        });

        provide('dragZoneId', props.modal?.uid);
        provide('_wwPopupStacked', props.stacked);

        return { localMethods, data };
    },
};
</script>
