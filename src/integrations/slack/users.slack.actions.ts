import { WebClient } from '@slack/web-api';

global.registerAction('slack/users-list', async ({ args = {} }: ActionParams, context: ActionContext) => {
    const client = new WebClient(context.connection?.botToken);

    return await client.users.list({
        limit: args.limit,
        cursor: args.cursor,
        include_locale: args.include_locale,
        team_id: args.team_id,
    });
});
