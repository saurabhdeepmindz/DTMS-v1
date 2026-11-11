import axios from 'axios';

/*=============================================m_ÔÔ_m=============================================\
    The embed session of the dashboard or the editor shown inside ChatGPT (WeWeb MCP app, weweb-ai
    mcp/apps/weweb.app). Each app adds its own bits around it: _dashboard/services/chatgptEmbed and
    _manager/services/chatgptEmbed.

    There the app is a cross-site iframe: the session cookie is never sent. The MCP app page opens
    it with a one-time code in the hash (#wwEmbedCode=...), exchanged here for an embed token
    (weweb-back services/token) the app sends in the `ww-access-token` header and in its socket
    handshakes.

    The token lives in memory only, for the life of the page. Kept in sessionStorage, it would be
    there for any frame of the app in the same ChatGPT tab, including one framed by another ChatGPT
    app: a frame without a code never runs signed in. A reload of the frame, a code already spent
    or expired, or a session that ends: the app tells the MCP app page holding it, which calls the
    MCP for a fresh code and reopens it.
\================================================================================================*/

const CODE_PARAM = 'wwEmbedCode';
const SESSION_ENDED_MESSAGE = 'weweb-embed:session-ended';
// Where earlier versions kept the token: cleared, nothing reads it anymore
const LEGACY_STORAGE_KEY = 'ww-embed-token';
// The MCP app page reopens the app within a second or two: past this, it will not
const ENDED_NOTICE_DELAY_MS = 8000;

/** The WeWeb API, where the code is exchanged and the token renewed. */
export const embedApiRoot = (import.meta.env.VITE_APP_API_URL || '').replace(/\/v1$/, '');

let embedToken = null;

export const getEmbedToken = () => embedToken;

export const isEmbedSession = () => !!embedToken;

export const hasEmbedCode = () => new URLSearchParams(window.location.hash.slice(1)).has(CODE_PARAM);

/** A message to the MCP app page holding the app. */
export const postToEmbedApp = message => window.parent.postMessage(message, '*');

let sessionEnded = false;

/**
 * Replaces the app by a message: the embed session is over (expired, revoked, or never started). The MCP app page
 * holding it is told, to reopen it with a fresh code where the user was.
 */
export const endEmbedSession = () => {
    // Once: the MCP app page replaces the whole frame
    if (sessionEnded) return;
    sessionEnded = true;
    clearTimeout(refreshTimer);
    embedToken = null;
    const notice = text =>
        (document.body.innerHTML = `
        <div style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; padding: 16px; text-align: center; color: #555;">
            ${text}
        </div>`);
    const ended = 'This WeWeb session has ended. Ask ChatGPT to open WeWeb again.';

    if (window.parent === window) return notice(ended);
    postToEmbedApp({ type: SESSION_ENDED_MESSAGE, path: `${window.location.pathname}${window.location.search}` });
    notice('Opening WeWeb…');
    setTimeout(() => notice(ended), ENDED_NOTICE_DELAY_MS);
};

const exchangeCode = async code => {
    const { data } = await axios.post(`${embedApiRoot}/v2/users/embed/session`, { code }, { withCredentials: false });
    return data.token;
};

// The embed token lasts 1 h: renewed ahead of its expiry, never past the session it is bound to (weweb-back services/token).
// Timed from its lifetime and the local clock only: a skewed local clock must not turn renewal into a loop.
// Renewed 10 min ahead, at most a sixth of its lifetime ahead (50 min into a 1 h token, 50 s into a 1 min one)
const REFRESH_AHEAD_MS = 10 * 60 * 1000;
const REFRESH_MIN_DELAY_MS = 10 * 1000;
const REFRESH_RETRY_MS = 60 * 1000;
let refreshTimer = null;
let refreshDueAt = 0;

const tokenLifetimeMs = token => {
    try {
        const { iat, exp } = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        return (exp - iat) * 1000;
    } catch (error) {
        return 0;
    }
};

const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    const lifetime = tokenLifetimeMs(embedToken);
    const delay = Math.max(lifetime - Math.min(REFRESH_AHEAD_MS, lifetime / 6), REFRESH_MIN_DELAY_MS);
    refreshDueAt = Date.now() + delay;
    refreshTimer = setTimeout(refreshEmbedToken, delay);
};

const refreshEmbedToken = async () => {
    clearTimeout(refreshTimer);
    try {
        const { data } = await axios.post(
            `${embedApiRoot}/v2/users/embed/refresh`,
            {},
            { withCredentials: false, headers: { 'ww-access-token': embedToken } }
        );
        embedToken = data.token;
        scheduleRefresh();
    } catch (error) {
        // The session is over (expired, logout): the MCP app page reopens the app with a fresh code
        if (error.response?.status === 401 || error.response?.status === 403) return endEmbedSession();
        refreshDueAt = Date.now() + REFRESH_RETRY_MS;
        refreshTimer = setTimeout(refreshEmbedToken, REFRESH_RETRY_MS);
    }
};

// Timers of a hidden page are throttled: catch up when it shows again
const refreshWhenBack = () => {
    if (document.visibilityState === 'visible' && embedToken && Date.now() >= refreshDueAt) refreshEmbedToken();
};

/** Starts the embed session of a framed app from the code in its URL. Resolves to false when there is none to start. */
export const startEmbedSession = async () => {
    try {
        sessionStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch (error) {
        // Storage blocked: nothing kept there either
    }

    const params = new URLSearchParams(window.location.hash.slice(1));
    const code = params.get(CODE_PARAM);
    if (!code) return false;

    // The code is single-use: it leaves the URL right away
    params.delete(CODE_PARAM);
    const hash = params.toString();
    window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ''}`
    );
    try {
        embedToken = await exchangeCode(code);
    } catch (error) {
        // Spent (a reload that kept it, the router putting it back) or expired: the MCP app page hands a fresh one
        return false;
    }
    if (!embedToken) return false;

    scheduleRefresh();
    document.addEventListener('visibilitychange', refreshWhenBack);
    return true;
};
