import { getHubspotClient, emptyToUndefined } from './hubspot.utils.ts';

global.registerAction('hubspot/forms-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.marketing.forms.formsApi.getPage(
        emptyToUndefined(args.after),
        args.limit ?? undefined,
        args.archived ?? undefined
    );
});

global.registerAction('hubspot/forms-get', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = getHubspotClient(context.connection);
    return await client.marketing.forms.formsApi.getById(args.formId);
});

// Form submission lives on api.hsforms.com and is not covered by the SDK. The portal id
// is resolved from the token (account-info) so users never have to type it.
global.registerAction('hubspot/forms-submit', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const accessToken = context.connection?.accessToken;
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

    const accountResponse = await fetch('https://api.hubapi.com/account-info/v3/details', { headers });
    const account = await accountResponse.json();
    if (!accountResponse.ok) throw account;

    const response = await fetch(
        `https://api.hsforms.com/submissions/v3/integration/submit/${account.portalId}/${args.formGuid}`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({
                fields: args.fields,
                context: emptyToUndefined(args.context),
                legalConsentOptions: emptyToUndefined(args.legalConsentOptions),
            }),
        }
    );
    // hsforms returns HTML error pages for malformed URLs — surface those readably.
    const text = await response.text();
    let data: any;
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = { status: response.status, body: text.slice(0, 500) };
    }
    if (!response.ok) throw data;
    return data;
});
