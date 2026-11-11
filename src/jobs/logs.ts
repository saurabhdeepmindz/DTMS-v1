import { Console } from 'node:console';
import { Writable } from 'node:stream';
import { diagnostic, LOG_LIMIT } from './validation.ts';

/** Each attempt keeps its own bounded console output alongside workflow diagnostics. */
export function captureAttemptLogs() {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    const output = new Writable({
        write(chunk: Buffer, _encoding, done) {
            const remaining = LOG_LIMIT - bytes;
            truncated ||= chunk.byteLength > remaining;
            if (remaining > 0) {
                const value = Buffer.from(chunk.subarray(0, remaining));
                chunks.push(value);
                bytes += value.byteLength;
            }

            done();
        },
    });

    return {
        console: new Console({ stdout: output, stderr: output }),
        read(workflow: unknown) {
            const value = diagnostic({ workflow, console: Buffer.concat(chunks).toString('utf8') }, LOG_LIMIT);
            value.truncated ||= truncated;

            return value;
        },
        close() {
            output.end();
        },
    };
}
