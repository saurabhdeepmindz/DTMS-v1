import { holdAppAccessSecrets } from '../services/env.service.ts';

const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
const wewebEnv = process.env.ENV || 'editor';

export const originalEnv = JSON.parse(JSON.stringify(process.env));

if (isLambda) {
    const ALLOWED_ENV_VARS = [
        'NODE_ENV',
        'PORT',
        'S3_LAMBDA_URL',
        'JOBS_LAMBDA_URL',
        'AI_PROXY_URL',
        'AWS_LAMBDA_FUNCTION_NAME',
        'AWS_LAMBDA_FUNCTION_VERSION',
        'AWS_LAMBDA_FUNCTION_MEMORY_SIZE',
        'AWS_LAMBDA_LOG_GROUP_NAME',
        'AWS_LAMBDA_LOG_STREAM_NAME',
        'LAMBDA_INVOKE_MODE',
        'LATE_RESPONSE_TIMEOUT_MS',
        'RESPONSE_STREAM_HEARTBEAT_INTERVAL_MS',
    ];
    for (const key of Object.keys(process.env || {})) {
        if (!ALLOWED_ENV_VARS.includes(key)) delete process.env[key];
    }
}

try {
    process.loadEnvFile(`.env`);
} catch (e) {
    console.warn(`No .env file found`);
}

try {
    process.loadEnvFile(`.env.${wewebEnv}`);
} catch (e) {
    console.warn(`No .env.${wewebEnv} file found`);
}

// Before any workflow runs.
holdAppAccessSecrets(originalEnv);
