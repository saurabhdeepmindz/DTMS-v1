/** Direct SQL and PostgREST use the same named, typed operation parameters. */
function sqlName(value: string): string {
    if (!/^[a-z][a-zA-Z]*$/.test(value)) throw new Error('Invalid Scheduled Tasks SQL identifier');
    return value.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase());
}

export function jobsSqlCall(operation: string, payload: object = {}, schema = 'jobs') {
    if (!/^jobs(?:_(?:staging|production))?$/.test(schema)) throw new Error('Invalid Scheduled Tasks schema');
    const name = schema + '_' + sqlName(operation);
    const entries = Object.entries(payload).filter(([, value]) => value !== undefined);
    const args = Object.fromEntries(entries.map(([key, value]) => ['p_' + sqlName(key), value]));
    const jsonFields = new Set([
        'jobs',
        'schedules',
        'definitions',
        'ids',
        'sections',
        'logs',
        'result',
        'occurrences',
        'labels',
    ]);
    if (operation !== 'reconciliation') jsonFields.add('error');
    const values = entries.map(([key, value]) => (jsonFields.has(key) ? JSON.stringify(value) : value));
    const parameters = Object.keys(args).map((key, index) => key + ' => $' + (index + 1));
    return { name, args, values, sql: 'SELECT public.' + name + '(' + parameters.join(', ') + ') AS result' };
}
