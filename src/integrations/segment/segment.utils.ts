import { Analytics } from '@segment/analytics-node';

export function createSegmentClient(connection: ConnectionConfig) {
    return new Analytics({ writeKey: connection.backWriteKey, flushAt: 1 });
}
