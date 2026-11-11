const MIN_HEARTBEAT_INTERVAL_MS = 1000;
const DEFAULT_LATE_RESPONSE_TIMEOUT_MS = 110000;
const DEFAULT_RESPONSE_STREAM_HEARTBEAT_INTERVAL_MS = 25000;

export function parseMillisecondsEnv(name: string, fallback: number) {
    const rawValue = process.env[name];
    if (rawValue === undefined || rawValue === '') return fallback;

    const value = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(value)) return fallback;
    return value;
}

export function getLateResponseTimeoutMs() {
    return parseMillisecondsEnv('LATE_RESPONSE_TIMEOUT_MS', DEFAULT_LATE_RESPONSE_TIMEOUT_MS);
}

export function getResponseStreamHeartbeatIntervalMs() {
    return Math.max(
        parseMillisecondsEnv('RESPONSE_STREAM_HEARTBEAT_INTERVAL_MS', DEFAULT_RESPONSE_STREAM_HEARTBEAT_INTERVAL_MS),
        MIN_HEARTBEAT_INTERVAL_MS
    );
}
