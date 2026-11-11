import { isEditorRuntimeEnabled } from '../../services/editorRuntime.service.ts';

export const getHealth = async c => {
    return c.json({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
};

export const getVersion = async c => {
    const projectVersion = Number.parseInt(process.env.WEWEB_PROJECT_VERSION || '', 10);
    return c.json({
        baseVersion: process.env.SERVER_VERSION,
        projectVersion: Number.isNaN(projectVersion) ? null : projectVersion,
        capabilities: { editorLiveWebhookCredentials: isEditorRuntimeEnabled() },
    });
};
