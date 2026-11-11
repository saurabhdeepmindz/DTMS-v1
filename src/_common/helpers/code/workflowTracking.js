 
// Auth integrations whose actions should trigger AUTH_WORKFLOW_RUN.
// Pure auth integrations (null): any action qualifies.
// Mixed integrations (string prefix): only actions starting with the prefix qualify.
const AUTH_INTEGRATIONS = {
    'weweb-auth': null,
    auth0: null,
    openid: null,
    'custom-auth': null,
    supabase: 'auth-',
    xano: 'auth-',
};

function isAuthAction(type) {
    const [integration, actionName] = type?.split('/') ?? [];
    if (!(integration in AUTH_INTEGRATIONS)) return false;
    const prefix = AUTH_INTEGRATIONS[integration];
    return prefix === null || actionName?.startsWith(prefix);
}

 
export function trackAuthWorkflowRun(workflow) {
    try {
        const authProviders = [
            ...new Set(
                Object.values(workflow.actions ?? {})
                    .filter(a => isAuthAction(a.type))
                    .map(a => a.type.split('/')[0])
            ),
        ];

        if (!authProviders.length) return;

        const projectId = wwLib.store.websiteData.designInfo?.id;

        wwLib.getEditorWindow().analytics?.track('AUTH_WORKFLOW_RUN', {
            project_id: projectId,
            workflow_id: workflow.id,
            workflow_name: workflow.name,
            providers: authProviders,
        });
    } catch {
        // never block workflow execution
    }
}
