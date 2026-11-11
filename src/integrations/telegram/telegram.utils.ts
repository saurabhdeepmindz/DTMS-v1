const TELEGRAM_API_BASE = 'https://api.telegram.org';

export async function callTelegram(botToken: string | undefined, method: string, body: Record<string, any>) {
    if (!botToken) {
        throw {
            ok: false,
            description:
                'No bot token found on the Telegram connection — check the connection selected on this action.',
        };
    }
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await response.json();

    if (!response.ok || !data.ok) throw data;
    return data.result;
}
