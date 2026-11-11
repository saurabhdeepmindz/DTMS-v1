import {
    TRUNCATED_PLACEHOLDER,
    captureBounded,
    createNodeBudget,
    utf8ByteLength,
} from './workflowDiagnostics/boundedCapture.ts';

// Transient editor debug payloads (socket and HTTP debug responses) keep a larger byte budget than persisted logs,
// but their work is bounded by the same capture core.
const DEBUG_LOG_LIMITS = {
    maxTotalBytes: 900000,
    // computedConfig filter leaves sit at depth 7+; size stays bounded by the byte/array/key limits
    maxDepth: 12,
    maxArrayLength: 50,
    maxObjectKeys: 50,
    maxStringLength: 250,
    maxNodes: 20000,
    maxTruncations: 100,
};
// __metadata is added after capture; its room is reserved so the whole encoded payload fits maxTotalBytes.
const METADATA_RESERVE_BYTES = 32 * 1024;
// JSON quotes and the truncation suffix, so strings keep about maxStringLength characters.
const STRING_OVERHEAD_BYTES = 2 + `...${TRUNCATED_PLACEHOLDER}`.length;
const SKIP_KEYS = new Set(['__metadata']);

// Wrapper keys such as {"result":…,"__metadata":…} around the metadata itself.
const WRAPPER_BYTES = 64;

// Drops the last truncation entries if escaped paths would overflow the reserved metadata room.
function fitMetadata(metadata) {
    let bytes = utf8ByteLength(JSON.stringify(metadata));
    while (bytes > METADATA_RESERVE_BYTES - WRAPPER_BYTES && metadata.truncations.length) {
        const entry = metadata.truncations.pop();
        bytes -= utf8ByteLength(JSON.stringify(entry)) + 1;
    }
    return metadata;
}

export function sanitizeWorkflowDebugResults(value, limits = DEBUG_LOG_LIMITS) {
    const captured = captureBounded(value, {
        maxBytes: limits.maxTotalBytes - METADATA_RESERVE_BYTES,
        budget: createNodeBudget(limits.maxNodes),
        maxDepth: limits.maxDepth,
        maxArrayItems: limits.maxArrayLength,
        maxObjectKeys: limits.maxObjectKeys,
        maxStringBytes: limits.maxStringLength + STRING_OVERHEAD_BYTES,
        maxTruncations: limits.maxTruncations,
        skipKeys: SKIP_KEYS,
        detectFileLike: true,
    });
    if (!captured.truncationCount) return captured.value;

    const metadata = fitMetadata({
        truncated: true,
        limits,
        truncationCount: captured.truncationCount,
        reasons: captured.reasons,
        truncations: captured.truncations,
    });

    const sanitized = captured.value;
    if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
        return { ...sanitized, __metadata: metadata };
    }
    return { result: sanitized, __metadata: metadata };
}

export { DEBUG_LOG_LIMITS, TRUNCATED_PLACEHOLDER };
