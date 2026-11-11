# Self-hosting an internal app

An internal app is only for the people and groups of the company directory it is given to. They sign in with their company Google or Microsoft account. The app checks who signs in on its own server, against who can use it in its own database, and never calls WeWeb to do so.

Hosted by WeWeb, it gets the people of the company directory who can use it, and its grants, pushed into its database. Self-hosted, WeWeb can't reach it, as it is often behind a firewall. Instead, the server pulls them from WeWeb with `node index.mjs access:pull`, which you run every few minutes.

## On WeWeb

- The project is internal, and its workspace's directory is connected on the Single sign-on page, with its OAuth client set.
- The project uses WeWeb Auth and has a production database on WeWeb. That database keeps who can use the app: you give and take away access from the project's Access page, as for an app WeWeb hosts. An export is refused until this is all set, with what is missing.
- The pull goes through WeWeb's public API, so the workspace's plan must include it.

## Environment

The export's `.env.production` (or `.env.staging`) holds the app's sign-in settings (`APP_ACCESS_*`) and `APP_ACCESS_PULL_URL`, where the pull asks WeWeb, over HTTPS. Set these yourself on the server:

- `APP_URL`: the app's public address, as people open it. Sign-ins come back to it.
- `APP_ACCESS_CLIENT_SECRET`: the workspace OAuth client's secret. Exports never contain secrets. The server takes it out of its environment when it starts, so the workflows' code and formulas don't get it through `process.env` or the environment variables. That code still runs on the server, though: keep the client for signing in only, as the Single sign-on page says.
- `DATABASE_URL`: the app's database, with WeWeb Auth's tables.

## Sign-in callback

On the workspace's OAuth client, add `<APP_URL>/api/auth/callback/google`, or `/api/auth/callback/microsoft`, as an authorized redirect URI. Apps hosted by WeWeb share one callback for the workspace. A self-hosted app has its own.

## Pulling who can use the app

Run the pull with the server's environment plus `WEWEB_PRIVATE_KEY`, every one to five minutes:

```sh
# crontab: every two minutes, the key read from a file only the pull's user can read
*/2 * * * * cd /srv/app && WEWEB_PRIVATE_KEY="$(cat /etc/app/weweb-private-key)" ENV=production node index.mjs access:pull >> /var/log/app-access.log 2>&1
```

A Kubernetes CronJob (the key in a Secret mounted in the job only) or a systemd timer works the same way.

`WEWEB_PRIVATE_KEY` is the workspace's private key, from its settings on WeWeb, under API keys. It opens WeWeb's public API for every project of the workspace. Give it to the pull only, never to the server: its workflows run code that could read it. A server started with it in its environment drops it and says so. If you generate a new key on WeWeb, update the pull's.

- **What it does:** it pulls what changed since the last run, a thousand directory changes at a time, for the people who can use the app only: those granted it, directly or through a group, and those who can open every project of the workspace, such as its owner and admins. It then replaces the database's grants with WeWeb's, and updates who can open every project. When who can use the app changes, it gets the directory again: those who no longer can are marked as gone, their row kept for the app's data that points to them.
- **The first run:** it creates the access tables next to WeWeb Auth's, from the SQL that comes with the export (the database user needs to create tables and add columns), then copies the directory of those who can use the app. Until it has run, nobody can sign in. It never runs SQL sent by WeWeb.
- **When it fails:** it exits with code 1 and says what to fix. Nothing is half-applied.
- **Several at once:** runs on several replicas are safe, but one is enough.

## How fresh the access is

- **Access taken away:** it is gone at the next pull.
- **Suspended accounts:** Google or Microsoft refuse a suspended company account at its next sign-in, whatever the pull. Sessions last 12 hours.
- **A pull that stopped:** set `APP_ACCESS_MAX_STALE_HOURS`, for example to `24`, to refuse new sign-ins when the last successful pull is older than that. People already signed in stay until their session ends. Without it, the app keeps the last list it pulled.

## What stays public

Every request to the server needs someone signed in and granted the app: pages' data, backend workflows and table views. The pages themselves (HTML, scripts, images) can be fetched by anyone, as for apps WeWeb hosts. Keep confidential content in the database rather than written into pages. Table views and APIs called from the browser are only protected by their own service. To close everything, put your own access proxy in front of the app.

The pull copies the names, emails and groups of the people who can use the app into its database, and the names of the company's groups. Nobody else of the directory is in it.
