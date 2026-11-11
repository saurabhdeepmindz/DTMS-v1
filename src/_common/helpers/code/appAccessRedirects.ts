import { getServerUrl } from './backendWorkflows.js';

// Internal apps: the project backend signs people in and refuses those who aren't granted the app. Kept apart from the
// server client, which builds its fetch on import: the sign-out of WeWeb Auth needs these without it.

let isAppAccessSignedOut = false;

export function redirectToAppAccessSignIn() {
    // Signing out: the requests it cuts short don't sign the person back in.
    if (isAppAccessSignedOut) return;
    window.location.href = `${getServerUrl()}api/ww/access/sign-in?redirect=${encodeURIComponent(window.location.href)}`;
}

// Signed out of an internal app, any of its pages would sign the person back in at once, the provider asking nothing:
// they stay on the signed-out page until they sign in again.
export function goToAppAccessSignedOut() {
    isAppAccessSignedOut = true;
    window.location.replace(`${getServerUrl()}api/ww/access/signed-out`);
}

export function redirectToAppAccessDenied() {
    window.location.href = `${getServerUrl()}api/ww/access/denied`;
}
