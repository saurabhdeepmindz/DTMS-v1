import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { getEditorRuntime } from './editorRuntime.service.ts';

export type RuntimeEnv = 'current' | 'editor' | 'staging' | 'production';
type ParsedRuntimeEnv = Exclude<RuntimeEnv, 'current'>;
type RuntimeEnvValues = Record<string, string | undefined>;
type ParsedRuntimeEnvMap = Record<ParsedRuntimeEnv, RuntimeEnvValues>;

const PARSED_RUNTIME_ENVS: ParsedRuntimeEnv[] = ['editor', 'staging', 'production'];

/**
 * An internal app's sign-in secrets: the company OAuth client's, and those signing the callbacks of this app's
 * addresses. Taken out of the environment once it is loaded (`holdAppAccessSecrets`), and left out of the stored ones:
 * the workflows' code and formulas read both.
 */
const APP_ACCESS_SECRET_NAMES = new Set(['APP_ACCESS_CLIENT_SECRET', 'APP_ACCESS_CALLBACK_SECRETS']);
const appAccessSecrets: RuntimeEnvValues = {};

/** Moves the secrets out of `process.env`, and out of the other copies of it given. */
export function holdAppAccessSecrets(...copies: RuntimeEnvValues[]) {
    for (const name of APP_ACCESS_SECRET_NAMES) {
        if (process.env[name] !== undefined) appAccessSecrets[name] = process.env[name];
        for (const env of [process.env, ...copies]) delete env[name];
    }
}

export function getAppAccessSecret(name: string): string | undefined {
    return appAccessSecrets[name] ?? process.env[name];
}

function parseEnvFile(filePath: string): RuntimeEnvValues {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = parseEnv(content);
        const values: RuntimeEnvValues = {};
        for (const key in parsed) {
            if (APP_ACCESS_SECRET_NAMES.has(key.toUpperCase())) continue;
            values[key] = parsed[key];
        }
        return values;
    } catch (_error) {
        return {};
    }
}

export function parseStoredEnvs(): ParsedRuntimeEnvMap {
    const parsedEnvMap: ParsedRuntimeEnvMap = {
        editor: {},
        staging: {},
        production: {},
    };

    for (const env of PARSED_RUNTIME_ENVS) {
        const envFilePath = path.resolve(process.cwd(), `.env.${env}`);
        parsedEnvMap[env] = parseEnvFile(envFilePath);
    }

    return parsedEnvMap;
}

function getEnvValues(env: RuntimeEnv = 'current'): RuntimeEnvValues {
    const runtime = getEditorRuntime();
    if (runtime) return runtime.envVariables[env === 'current' ? 'editor' : env];
    if (env === 'current') return process.env;
    return parseEnvFile(path.resolve(process.cwd(), `.env.${env}`));
}

function findEnvValue(values: RuntimeEnvValues, key: string): { found: boolean; value?: string } {
    if (Object.hasOwn(values, key)) return { found: true, value: values[key] };

    const canonicalKey = key.toUpperCase();
    let matchingKey: string | undefined;
    for (const existingKey in values) {
        if (existingKey.toUpperCase() !== canonicalKey) continue;
        if (matchingKey !== undefined) return { found: true };
        matchingKey = existingKey;
    }

    return matchingKey === undefined ? { found: false } : { found: true, value: values[matchingKey] };
}

export function getEnv(key: string, env: RuntimeEnv = 'current'): string | undefined {
    const envValue = findEnvValue(getEnvValues(env), key);
    if (envValue.found || env === 'current' || getEditorRuntime()) return envValue.value;
    return findEnvValue(process.env, key).value;
}

export function getFormulaEnvironmentNames(packagedNames: Iterable<string>): ReadonlySet<string> {
    const runtime = getEditorRuntime();
    if (!runtime) return new Set(packagedNames);
    return new Set(Object.values(runtime.envVariables).flatMap(values => Object.keys(values)));
}

export function getFormulaEnv(
    key: string,
    allowedNames: ReadonlySet<string>,
    env: RuntimeEnv = 'current'
): string | undefined {
    if (!allowedNames.has(key)) return undefined;
    return findEnvValue(getEnvValues(env), key).value;
}

export function getFormulaEnvValues(
    keys: Iterable<string>,
    allowedNames: ReadonlySet<string>,
    env: RuntimeEnv = 'current'
): Record<string, string> {
    const allowedKeys = [...new Set(keys)].filter(key => allowedNames.has(key));
    if (!allowedKeys.length) return {};

    const values = { ...getEnvValues(env) };
    const result: Record<string, string> = {};
    for (const key of allowedKeys) {
        const value = findEnvValue(values, key).value;
        if (value !== undefined) result[key] = value;
    }
    return result;
}

export default {
    holdAppAccessSecrets,
    getAppAccessSecret,
    parseStoredEnvs,
    getEnv,
    getFormulaEnv,
    getFormulaEnvValues,
};
