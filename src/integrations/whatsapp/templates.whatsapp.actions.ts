import { API_BASE, getHeaders, getBusinessAccountId, buildQueryString, clampLimit } from './whatsapp.utils.ts';

global.registerAction('whatsapp/create-template', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const components: Record<string, any>[] = [];
    if (args.headerText) {
        components.push({ type: 'HEADER', format: 'TEXT', text: args.headerText });
    }
    const body: Record<string, any> = { type: 'BODY', text: args.bodyText };
    if (Array.isArray(args.bodyExamples) && args.bodyExamples.length) {
        body.example = { body_text: [args.bodyExamples.map((example: any) => String(example))] };
    }
    components.push(body);
    if (args.footerText) {
        components.push({ type: 'FOOTER', text: args.footerText });
    }

    const headers = getHeaders(context.connection);
    const response = await fetch(
        `${API_BASE}/${encodeURIComponent(getBusinessAccountId(context.connection))}/message_templates`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({
                name: args.name,
                category: args.category,
                language: args.language,
                components,
            }),
        }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw data;
    return data;
});

global.registerAction('whatsapp/list-templates', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const params = {
        fields: 'id,name,category,language,status,components',
        limit: clampLimit(args.limit),
        status: args.status,
        category: args.category,
        name_or_content: args.nameOrContent,
        after: args.after,
    };

    const headers = getHeaders(context.connection);
    const response = await fetch(
        `${API_BASE}/${encodeURIComponent(getBusinessAccountId(context.connection))}/message_templates${buildQueryString(params)}`,
        { headers }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw data;
    return data;
});

global.registerAction('whatsapp/delete-template', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const params: Record<string, any> = { name: args.name };
    // hsm_id scopes the deletion to one template id; without it Meta deletes all language variants of the name.
    if (args.templateId) params.hsm_id = args.templateId;

    const headers = getHeaders(context.connection);
    const response = await fetch(
        `${API_BASE}/${encodeURIComponent(getBusinessAccountId(context.connection))}/message_templates${buildQueryString(params)}`,
        {
            method: 'DELETE',
            headers,
        }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw data;
    return data;
});
