import { ref } from 'vue';

export function useFlyOutHover() {
    const isFlyOutHover = ref(false);

    const ignored = ref(false);
    const timeout = ref<NodeJS.Timeout | null>(null);

    function onMouseOver() {
        if (timeout.value) {
            clearTimeout(timeout.value);
            timeout.value = null;
        }
        if (!ignored.value) {
            isFlyOutHover.value = true;
        }
    }

    function onMouseLeave() {
        ignored.value = false;
        timeout.value = setTimeout(() => {
            isFlyOutHover.value = false;
        }, 100);
    }

    return {
        isFlyOutHover,
        onMouseOver,
        onMouseLeave,
    };
}
