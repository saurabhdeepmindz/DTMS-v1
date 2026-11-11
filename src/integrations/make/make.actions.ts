import { Make } from '@makehq/sdk';

global.registerAction('make/scenarios-run', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const make = new Make(context.connection?.apiKey, `${context.connection?.zone}.make.com`);

    // hookId / ping url are returned by the API but missing from the SDK's typings
    const scenario = (await make.scenarios.get(args.scenarioId)) as Record<string, any>;
    if (!scenario?.hookId) throw new Error('This scenario does not have a webhook trigger');

    const hookPing = (await make.hooks.ping(scenario.hookId)) as Record<string, any>;
    const webhookUrl = hookPing?.address || hookPing?.url;
    if (!webhookUrl) throw new Error('Could not resolve webhook URL for this scenario');

    const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args.data ?? {}),
    });

    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch {
        if (!response.ok) throw text;
        return text;
    }
});
