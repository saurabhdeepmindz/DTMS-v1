import { existsSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_OLD_SPACE_SIZE_MB = 512;

type RendererSandboxOptions = {
    importMapPath: string;
    readPaths: string[];
    resultFile: string;
    scriptPath: string;
    scriptArguments: string[];
    maxOldSpaceSizeMb?: number;
    sourceEnvironment?: NodeJS.ProcessEnv;
};

export type RendererSandbox = {
    command: string;
    arguments: string[];
    environment: NodeJS.ProcessEnv;
};

/**
 * Creates the least-privileged Deno profile used to execute the generated SSR
 * bundle. The bundle contains project-provided component code, so it receives
 * only the runtime files it needs and never inherits publisher credentials.
 */
export function createRendererSandbox({
    importMapPath,
    readPaths,
    resultFile,
    scriptPath,
    scriptArguments,
    maxOldSpaceSizeMb = DEFAULT_MAX_OLD_SPACE_SIZE_MB,
    sourceEnvironment = process.env,
}: RendererSandboxOptions): RendererSandbox {
    const resolvedImportMapPath = path.resolve(importMapPath);
    const resolvedReadPaths = [
        ...new Set([...readPaths.map(readPath => path.resolve(readPath)), resolvedImportMapPath]),
    ];
    const resolvedResultFile = path.resolve(resultFile);
    const resolvedScriptPath = path.resolve(scriptPath);

    return {
        command: getDenoBinary(sourceEnvironment),
        arguments: [
            'run',
            '--no-config',
            '--cached-only',
            '--no-remote',
            '--node-modules-dir=manual',
            '--no-prompt',
            `--import-map=${resolvedImportMapPath}`,
            `--v8-flags=--max-old-space-size=${maxOldSpaceSizeMb}`,
            `--allow-read=${resolvedReadPaths.join(',')}`,
            `--allow-write=${resolvedResultFile}`,
            '--allow-env',
            '--deny-net',
            '--deny-run',
            '--deny-sys',
            '--deny-ffi',
            '--deny-import',
            resolvedScriptPath,
            ...scriptArguments,
        ],
        environment: {
            NODE_ENV: sourceEnvironment.NODE_ENV || 'production',
            TZ: sourceEnvironment.TZ || 'UTC',
        },
    };
}

function getDenoBinary(sourceEnvironment: NodeJS.ProcessEnv): string {
    if (sourceEnvironment.WW_DENO_BIN) return sourceEnvironment.WW_DENO_BIN;
    return existsSync('/usr/local/bin/deno') ? '/usr/local/bin/deno' : 'deno';
}
