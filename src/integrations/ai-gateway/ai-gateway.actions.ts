import { buildGenerateTextAction } from './actions/generate-text.action.ts';
import { buildEmbedTextAction } from './actions/embed-text.action.ts';
import { buildGenerateImageAction } from './actions/generate-image.action.ts';
import { buildGenerateSpeechAction } from './actions/generate-speech.action.ts';
import { buildTranscribeSpeechAction } from './actions/transcribe-speech.action.ts';
import { getProviderApiKeyEnvName } from './utils/resolve-runtime.ts';
import { getEnv, type RuntimeEnv } from '../../services/env.service.ts';

function buildActions() {
    const env = process.env.ENV;
    const wwProjectSecret = process.env.WEWEB_PROJECT_SECRET;

    const proxyUrl = process.env.AI_PROXY_URL;

    const wwProjectId = process.env.WEWEB_PROJECT_ID;
    if (!wwProjectId) throw new Error('WEWEB_PROJECT_ID is not configured');

    const getApiKey = (provider: string) => {
        return getEnv(getProviderApiKeyEnvName(provider), env as RuntimeEnv);
    };
    const generateTextAction = buildGenerateTextAction({ proxyUrl, env, wwProjectSecret, wwProjectId, getApiKey });
    const embedTextAction = buildEmbedTextAction({ proxyUrl, env, wwProjectSecret, wwProjectId, getApiKey });
    const generateImageAction = buildGenerateImageAction({ proxyUrl, env, wwProjectSecret, wwProjectId, getApiKey });
    const generateSpeechAction = buildGenerateSpeechAction({ proxyUrl, env, wwProjectSecret, wwProjectId, getApiKey });
    const transcribeSpeechAction = buildTranscribeSpeechAction({
        proxyUrl,
        env,
        wwProjectSecret,
        wwProjectId,
        getApiKey,
    });

    return {
        generateTextAction,
        embedTextAction,
        generateImageAction,
        generateSpeechAction,
        transcribeSpeechAction,
    };
}

for (const action of Object.values(buildActions())) {
    global.registerAction(`ai-gateway/${action.name}`, action.handler);
}
