// A phone, held either way, gets the mobile layout of the editor and the dashboard: a narrow window, or a touch screen
// too short for the desktop layout (a large phone held sideways is wide, but short; tablets are taller).
export const MOBILE_SCREEN_QUERY = '(max-width: 767px), (pointer: coarse) and (max-height: 500px)';

// What the mobile styles hang on (`.ww-mobile &`), set on the <html> of the app: one condition for the CSS and the JS
export const MOBILE_SCREEN_CLASS = 'ww-mobile';

/**
 * On a phone, two fingers zoom what the editor decides (the canvas, a workflow), never the whole page: the viewport
 * meta forbids it, which Safari ignores. `editorDocument` holds the class, the document listened to may be the canvas'.
 */
export function preventPageZoom(listenedDocument, editorDocument = listenedDocument) {
    const isMobile = () => editorDocument.documentElement.classList.contains(MOBILE_SCREEN_CLASS);
    const preventOnMobile = event => {
        if (isMobile()) event.preventDefault();
    };
    // Safari's own pinch events
    listenedDocument.addEventListener('gesturestart', preventOnMobile);
    listenedDocument.addEventListener('gesturechange', preventOnMobile);
    listenedDocument.addEventListener(
        'touchmove',
        event => {
            if (event.touches.length > 1) preventOnMobile(event);
        },
        { passive: false }
    );
}

/** Keeps the class on the <html> of the window as the screen changes (a rotation, a resized window). */
export function syncMobileScreenClass(targetWindow = window) {
    const mediaQueryList = targetWindow.matchMedia(MOBILE_SCREEN_QUERY);
    const update = () =>
        targetWindow.document.documentElement.classList.toggle(MOBILE_SCREEN_CLASS, mediaQueryList.matches);
    update();
    mediaQueryList.addEventListener('change', update);
}
