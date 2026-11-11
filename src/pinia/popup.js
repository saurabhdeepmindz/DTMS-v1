import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import ShortUniqueId from 'short-unique-id';
const createId = new ShortUniqueId();
 
export const usePopupStore = defineStore('popups', () => {
    const availablePopups = computed(() => {
        const libraryId = wwLib.store.libraries.library.id;
        return Object.values(wwLib.store.libraries.components)
            .filter(libraryComponent => libraryComponent.type === 'modal' && libraryComponent.libraryId === libraryId)
            .map(libraryComponent => {
                return {
                    name: libraryComponent.name,
                    libraryComponentBaseId: libraryComponent.id,
                    libraryId,
                };
            });
    });

    const onClosePromises = {};

    const instances = ref({});

    async function open(libraryComponentBaseId, content, { waitClosing = false } = {}) {
        if (!wwLib.store.libraries.components[libraryComponentBaseId]?.configuration?.popup?.isStacked) {
            const existingInstance = Object.values(instances.value).find(
                instance => instance.libraryComponentBaseId === libraryComponentBaseId
            );
            if (existingInstance) {
                // Reuse the already-open instance and wait for its close result.
                if (waitClosing) {
                    return new Promise(resolve => {
                        const previousResolve = onClosePromises[existingInstance.uid];
                        onClosePromises[existingInstance.uid] = data => {
                            previousResolve?.(data);
                            resolve(data);
                        };
                    });
                }
                return Promise.resolve(existingInstance.uid);
            }
        }

        const uid = `popup-${createId.rnd()}`;
        const instance = {
            uid,
            libraryComponentBaseId,
            content,
        };
        wwLib.store.websiteData.ensureStyleSourceIds([instance], { runtime: true });
        instances.value[uid] = instance;
        if (waitClosing) {
            return new Promise(resolve => {
                onClosePromises[uid] = resolve;
            });
        }
        return Promise.resolve(uid);
    }

    function close(uid, data) {
        delete instances.value[uid];
        if (onClosePromises[uid]) {
            onClosePromises[uid](data);
            delete onClosePromises[uid];
        }
    }

    function closeAll(libraryComponentBaseId) {
        Object.keys(instances.value).forEach(uid => {
            if (instances.value[uid].libraryComponentBaseId === libraryComponentBaseId) {
                close(uid);
            }
        });
    }
 
    return {
        availablePopups,
        open,
        close,
        closeAll,
        instances,
        stackedPopupUids: computed(() => {
            const stacks = {};
            Object.values(instances.value).forEach(popup => {
                const isStacked =
                    wwLib.store.libraries.components[popup.libraryComponentBaseId]?.configuration?.popup?.isStacked &&
                    wwLib.store.libraries.components[popup.libraryComponentBaseId]?.configuration?.popup?.containerUid;
                if (!isStacked) return;
                const containerUid =
                    wwLib.store.libraries.components[popup.libraryComponentBaseId]?.configuration?.popup?.containerUid;
                if (!stacks[containerUid]) {
                    stacks[containerUid] = [];
                }
                stacks[containerUid].push(popup.uid);
            });

            return stacks;
        }),
        singlePopupUids: computed(() => {
            return Object.keys(instances.value).filter(uid => {
                const popup = instances.value[uid];
                return !wwLib.store.libraries.components[popup.libraryComponentBaseId]?.configuration?.popup?.isStacked;
            });
        }),
     };
});
