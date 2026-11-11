import { HTTPException } from 'hono/http-exception';

export function throwDbError(err) {
    if (err instanceof HTTPException) throw err;

    // Only `message` is serialized; `detail` stays out of it (can carry row values, reaches published apps)
    throw new HTTPException(500, {
        message: err.hint ? `${err.message} — ${err.hint}` : err.message,
        cause: {
            code: err.code,
            detail: err.detail ?? err.details,
            hint: err.hint,
            constraint: err.constraint,
            table: err.table,
            schema: err.schema,
        },
    });
}
