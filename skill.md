---
name: weweb-integration-builder
description: >-
    Complete guide to creating a new WeWeb integration (front, back or fullstack) across the 4 WeWeb repos (weweb-editor, weweb-lambda-back-publisher, weweb-back, weweb-ai) and syncing it to weweb-ai. Always use this skill whenever a WeWeb developer asks to create, code, add, scaffold or "vibe-code" an integration, a connector, or a third-party service for WeWeb, even if the request doesn't explicitly mention the word "integration" (examples: "I want to add Stripe to WeWeb", "connect WeWeb to Notion", "add a new service"). Does NOT cover creating native workflow actions (see the weweb-native-action-builder skill for that).
---

# WeWeb Integration Builder

This skill guides the creation of a WeWeb integration end to end: the integration folder in the editor, front/back code if needed, core functions in weweb-back if needed, then syncing to weweb-ai.

A WeWeb integration lets you connect a third-party service (or expose capabilities) usable in the WeWeb editor and/or by the AI through the weweb-ai MCP server.

> **This skill is the single source of truth for HOW to build an integration.** The codebase still contains many older integrations written the legacy way. Do **not** imitate them — follow this skill (and the one modern reference integration it points to) exclusively. See ["Legacy vs current"](#legacy-vs-current--read-this-first) below.

## Legacy vs current — read this first

Separate two things: an integration's **form** (how the code is shaped) and its **mechanism** (how a capability is wired).

**The skill spec is the source of truth for FORM** (TypeScript, `build<Name>…()` factories, explicit `id`, `aiMetadata` everywhere, file naming — see [Non-negotiable conventions](#non-negotiable-conventions)). Where the skill and an existing folder disagree on form, the skill wins. For a code-shape reference, model on a fully-conformant integration — `ai-gateway` (`src/_manager/integrations/ai-gateway/`).

`ai-gateway` doesn't show every **mechanism** though (connection, table view, triggers, webhooks, core functions). For those, read whichever integration implements them (`stripe`, `airtable`, `supabase`, `xano`, `http-request`…) — that's expected. Integrations are migrated to the current form incrementally, so any given folder's form may lag these conventions. **Read them to learn the mechanism (the wiring, the API, what calls what), not to copy their form** — take the mechanism and re-express it in the skill's conventions.

These markers tell you a folder's **form** is outdated — the mechanism may still be correct, so learn it, then rewrite it in current form:

| Outdated form                                          | Current form (required)                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `.js` files (`index.js`, `actions/*.action.js`)        | `.ts` files everywhere                                                         |
| `export default { name, icon, ... }` plain object      | a `build<Name>Integration()` factory returning `... satisfies Integration`     |
| No `id` on the integration (relies on the folder name) | explicit `id` on the integration object                                        |
| Action = `export default { name, target, fields }`     | Action = `build<Name>Action()` factory with `id`, `type`, `categories`, `icon` |
| **No `aiMetadata`** anywhere                           | **`aiMetadata` on every action, every field, and every service**               |
| No typed service / no `.service.ts`                    | services typed with `IntegrationService<TParams, TResult>`                     |

## Non-negotiable conventions

These apply to every new integration, no exceptions:

1. **TypeScript only.** All files are `.ts` (or `.vue` for connection components). Never author `.js`.
2. **File naming must match the folder name exactly** — the extraction script keys off the folder name to find files:
    - `<folder>/index.ts`
    - `<folder>/<folder>.service.ts` (if it has services/core functions)
    - `<folder>/<folder>.skill.md`
        > e.g. for a folder `notion/`, the files must be `notion.service.ts` and `notion.skill.md`. A mismatched name is silently ignored by the extractor.
3. **Factory functions, not plain objects.** The integration is built by `build<Name>Integration()` returning an object `satisfies Integration`, with `export default build<Name>Integration()`. Each action is built by `build<Name>Action()`.
4. **Explicit `id`** on the integration object (don't rely on the folder name).
5. **Actions aggregated into a `Record`** keyed by `action.id` (see the reduce pattern in the example).
6. **`aiMetadata` is mandatory and everywhere** — see the next section. A missing `aiMetadata` is a bug: the AI cannot see or use anything that lacks it.
7. **Use the official SDK whenever possible instead of direct fetch or HTTP calls.** When connecting to a third-party service, always prefer the provider's SDK for integration—only resort to manual HTTP requests if no maintained SDK is available.

## `aiMetadata` — mandatory in three places

`aiMetadata` is what makes an integration usable by the AI through weweb-ai. It must be present in **all three** of the following places:

1. **On every action** (in the `build<Name>Action()` return):

    ```typescript
    aiMetadata: {
        description: string; // what the action does
        returns: string; // free-text shape of the result, e.g. "{ message: string }"
    }
    ```

2. **On every field** — including nested subsection fields and array `item` fields:

    ```typescript
    aiMetadata: {
      type: string;          // "string" | "number" | "boolean" | "array" | "object" | ...
      description: string;   // what the field expects, in AI-facing terms
      example?: unknown;     // optional
      required?: boolean;    // optional -> Only if action required is a function and it will not be proceed on AI linter
    }
    ```

    Note this is **separate from and in addition to** the field's UI metadata (`label`, `type`, `bindable`, `bindingValidation`, `description`, `placeholder`, `options`). A field carries both.

3. **On every service** (core function), via the `IntegrationService` type:

    ```typescript
    aiMetadata: {
      name: string;          // stable identifier of the core function
      description: string;
      path: string;          // e.g. "hello/random-number"
      inputSchema?: ZodSchema; // Zod schema; serialized to JSON Schema at extraction time
    }
    ```

> **`aiMetadata` is for the AI — not for the human builder.** A person using the action in the editor sees the field's **UI** metadata (`label`, `description`, `placeholder`), never `aiMetadata`. So don't stop at `aiMetadata`: give fields a builder-facing `description` that carries any non-obvious behavior (formatted with backticks / `<br><br>` / `**bold**`), and put cross-action recipes in the integration's skill file. Do **not** add `{ type: 'infobox' }` pseudo-fields to action forms (team rule; legacy ones like `auth0/logout` and `segment/reset` stay, and ConnectionEdit's InfoBox component is fine). Manual usability must not be sacrificed to the AI.

## Step 0 — Locate the repos

The 4 repos are independent and their local location varies for each developer — never assume a fixed path. **Before anything else, ask the user for the absolute local path of each of the required repos**:

- `weweb-editor` (always required)
- `weweb-lambda-back-publisher` (required if the integration has back or fullstack actions)
- `weweb-back` (required if the integration includes core functions)
- `weweb-ai` (always required, for the final sync)

Verify that each path actually exists (e.g. presence of a `package.json` at the root) before continuing. If a path isn't provided because the corresponding step isn't needed, don't get stuck on it.

## Step 1 — Understand the data model

Read the `Integration` typing before writing anything:

```
<weweb-editor>/src/_manager/integrations/integration.type.ts
```

This file is a Zod schema (`integrationSchema` / `Integration` type) that defines the expected shape of an integration. Key top-level keys: `id`, `name`, `icon`, `shortDescription`, `description`, `category`, `native`, `actions`, `connection`, `auth`, `storage`, `table`, `triggers`. Your `build<Name>Integration()` return value must satisfy this type (use `satisfies Integration`). Also read:

```
<weweb-editor>/src/_manager/integrations/integrationService.ts
```

for the `IntegrationService<TParams, TResult>` type used by core functions.

## Step 2 — Study the reference

**Before writing code, open the one canonical modern integration and skim it:**

```
<weweb-editor>/src/_manager/integrations/ai-gateway/
```

Note especially: `index.ts` (factory + `satisfies Integration` + reduce), `actions/*.action.ts` (`build…Action()` with `aiMetadata` on the action and on every field), `ai-gateway.service.ts` (typed `IntegrationService` objects), `utils/common-fields.ts` (shared field builders), and `ai-gateway.skill.md`.

The example below is a minimal, made-up "Hello" integration (a fictional service, not real) that distills the same pattern so you can see it in isolation. The goal is not to copy "Hello" verbatim but to reapply its structure and conventions.

> ⚠️ **`ai-gateway` does not cover the common cases.** It has no connection, no table, no triggers and no core functions — but a typical third-party integration (Notion, Airtable…) has all of them, and there is **no fully-modern reference** for those patterns yet. For connection / table view / event triggers / core functions, follow the documented patterns in Steps 4–5 below (they were written from the real, code-verified mechanism); read a legacy folder only to see a mechanism in situ, never as a style template to copy.

#### `index.ts`

Entry point: declares the integration, aggregates the actions.

```typescript
import CATEGORIES from '@/_manager/integrations/categories.js';
import { buildHelloPersonAction } from './actions/helloPerson.action.ts';
import type { Integration } from '../integration.type.ts';

export const buildHelloIntegration = () => {
    const buildHelloActions = () => {
        const actions = { buildHelloPersonAction };

        return Object.values(actions).reduce(
            (acc, actionFn) => {
                const action = actionFn();
                acc[action.id] = action;
                return acc;
            },
            {} as Record<string, ReturnType<(typeof actions)[keyof typeof actions]>>
        );
    };

    return {
        id: 'hello',
        name: 'Hello',
        native: true,
        icon: '16/hand',
        shortDescription: 'Minimal example integration that greets people',
        description:
            'Hello is a toy integration used as a teaching example. It exposes one action to greet a person by name, and one service to fetch a random number.',
        category: CATEGORIES.UTILS,
        actions: buildHelloActions(),
    } satisfies Integration;
};

export default buildHelloIntegration();
```

#### `index.ts` — variant with a connection

An integration can enforce a connection when it must connect to a real third-party service before its actions can run (e.g. an API key to fill in). It declares a `connection` field that drives the connection screen in the editor: a Vue component for the input form (`editComponent`), an optional step-by-step tutorial (`guideflowId`), and help steps in HTML (`steps`).

Adapted example (still fictional): a "Hello Remote" variant that calls an imaginary third-party API "Greetings Cloud" requiring an API key:

```typescript
import { markRaw } from 'vue';
import CATEGORIES from '@/_manager/integrations/categories.js';
import ConnectionEdit from './HelloRemoteConnectionEdit.vue';
import { buildHelloRemotePersonAction } from './actions/helloRemotePerson.action.ts';
import type { Integration } from '../integration.type.ts';

export const buildHelloRemoteIntegration = () => {
    const buildHelloRemoteActions = () => {
        const actions = { buildHelloRemotePersonAction };

        return Object.values(actions).reduce(
            (acc, actionFn) => {
                const action = actionFn();
                acc[action.id] = action;
                return acc;
            },
            {} as Record<string, ReturnType<(typeof actions)[keyof typeof actions]>>
        );
    };

    return {
        id: 'hello-remote',
        name: 'Hello Remote',
        icon: '16/hand',
        shortDescription: 'Greet people through the (fictional) Greetings Cloud API',
        description:
            'Hello Remote is a toy example of a a connection integration: it requires the user to connect their own Greetings Cloud API key before any action can run.',
        category: CATEGORIES.UTILS,
        connection: {
            editComponent: markRaw(ConnectionEdit),
            guideflowId: 'ab12cd34ef',
            steps: [
                'Sign in to your <a class="ww-editor-link ml-0" href="https://greetings.example.com/" target="_blank">Greetings Cloud account</a>.',
                'Open <a class="ww-editor-link ml-0" href="https://greetings.example.com/settings/api-keys" target="_blank">API Keys</a> and create a new key.',
                'Copy the API key and paste it below.',
            ],
        },
        actions: buildHelloRemoteActions(),
    } satisfies Integration;
};

export default buildHelloRemoteIntegration();
```

`ConnectionEdit` (`./HelloRemoteConnectionEdit.vue`) is a Vue component you write for this integration. Its contract (host: `EditorMenuIntegrations/ConnectionConfig.vue`): props `config` (the connection config object), `envChoices`, optional `connectionId`; emits `update:config` with the whole config object.

**Each credential field is an env-variable descriptor, not a raw string:**

```js
config.apiKey = { __envVariableKey: 'MYINT_API_KEY', editorValue: '', stagingValue: '', productionValue: '', secure: true };
```

On save, `ConnectionConfig` turns every `__envVariableKey` field into a project **environment variable** and stores only `{ __envVariableKey }` back in the config (the secret lives in the env-var table). `secure: true` means the value is **stripped** at staging/production resolution — never injected into those runtimes; use it for secrets. For a multi-env form, wrap fields in `IntegrationEnvWrapper` (`components/common/IntegrationEnvWrapper.vue`, `v-model` on the current env) and bind ``v-model="config.apiKey[`${env}Value`]"``; a single-env integration just mirrors the same value into all three `*Value`s. To surface a webhook URL, build it from `getServerUrl()` (`@/_common/helpers/code/backendWorkflows.js`, swapping `-editor` for `-${env}`) and copy it to the clipboard. Follow this contract rather than copying a legacy folder wholesale.

Always set `connection.steps` to include the full, direct URL to the integration’s API key setup page whenever possible. If a direct link isn’t available, clearly outline each step required for the user to obtain and set up their API key.

**Choosing native vs. non-native:**

- **Native integrations** are available by default in all projects.
- **Non-native integrations** must be explicitly installed in each project before use.  
  Before setting an integration as native (`native: true`), always confirm with the user if that's their intention.

**Choosing connection vs. non-connection:**

- **Connection integrations** require the user to connect to a third-party service before their actions can run.
- **Non-connection integrations** do not require the user to connect to a third-party service before their actions can run.
  Most of the time, integrations that enable an interface with a third-party service to weweb will need a connection.

#### `hello.service.ts`

`IntegrationService`: declares a core function (`aiMetadata` name/description/path/inputSchema in Zod) separated from its `execute()`. Export the services either as an array named `<folder>Services` (preferred, e.g. `helloServices`) or as individual named exports — the extractor picks up the `<folder>Services` array first, and otherwise any exported object that carries an `aiMetadata`.

```typescript
import type { IntegrationService } from '@/_manager/integrations/integrationService.ts';
import z from 'zod';

const getRandomNumberParameters = z.object({
    min: z.number().default(0),
    max: z.number().default(100),
});

type GetRandomNumberResult = { value: number };

export const getRandomNumberService: IntegrationService<typeof getRandomNumberParameters, GetRandomNumberResult> = {
    aiMetadata: {
        name: 'getRandomNumber',
        description: 'Get a random integer between min and max (inclusive)',
        path: 'hello/random-number',
        inputSchema: getRandomNumberParameters,
    },
    async execute({ min, max }) {
        const value = Math.floor(Math.random() * (max - min + 1)) + min;
        return { value };
    },
};

export const helloServices = [getRandomNumberService] as const;
```

#### `actions/helloPerson.action.ts`

Back action: a single field, `aiMetadata` on the action **and** on the field.

```typescript
export function buildHelloPersonAction() {
    return {
        id: 'hello-person',
        name: 'Hello Person',
        type: 'back',
        categories: ['Utils'],
        icon: '16/hand',
        target: () => ({ field: 'name' }),
        fields: getHelloPersonFields(),
        aiMetadata: {
            description: 'Greet a person by name, returning a friendly hello message.',
            returns: '{ message: string }',
        },
    };
}

function getHelloPersonFields() {
    return [
        {
            key: 'name',
            label: 'Name',
            type: 'text',
            required: true,
            bindable: true,
            bindingValidation: {
                tooltip: 'Expects a `string`.\n\nExample:\n`Ada`',
                type: 'string',
            },
            aiMetadata: {
                type: 'string',
                description: 'Name of the person to greet',
            },
            placeholder: 'Ada',
        },
    ];
}
```

#### `hello.skill.md`

The `.skill.md` file is documentation the AI reads **on top of** everything it already gets automatically from the extracted `aiMetadata` (every action, its description and `returns`, every field with its type/description/example, every service). It must exist (mandatory file, named `<folder>.skill.md`), but its only job is to add the **non-obvious, integration-specific knowledge that isn't already encoded elsewhere and that a competent AI wouldn't already know.** Every line costs tokens at read time, so write nothing that doesn't earn its place.

**Do NOT put in the skill file** (this is the most common failure — it produces long, useless files):

- A catalog / re-listing of the actions, their fields, their parameters or their return shapes. All of that already comes from `aiMetadata`; repeating it is pure token waste and drifts out of sync.
- Generic knowledge the model already has: what the third-party service is, what an API key is, how "connections" work in general, that you must verify a domain, that arrays hold strings, etc.
- A "Connection" section restating that an integration needs a connection — that's structural and already known.
- Restating field constraints already expressed in `bindingValidation` / `aiMetadata` (types, required-ness, examples).

**DO put in the skill file** — only genuinely useful, service-specific things:

- **Gotchas & surprising behaviors**: silent failures, undocumented limits, formatting quirks, values that look valid but aren't, error cases specific to this service.
- **Cross-action / cross-service workflows**: when action A's output must be fed into action B, required ordering, or a recommended multi-step recipe (see the image-generation → storage recipe in `ai-gateway.skill.md`).
- **Non-obvious constraints or trade-offs** that change how the AI should assemble a workflow.

Prefer short. A genuinely small file (or even a near-empty one) is **better** than a long file that restates what `aiMetadata` already says. Write only what a smart engineer wouldn't already guess. See `ai-gateway.skill.md` for the right spirit: workflow recipes and gotchas, not a field dump.

```markdown
# Hello Skill

- (only real, non-obvious, Hello-specific caveats go here — otherwise leave the file minimal)
```

**Key takeaways:**

- `index.ts` builds the `Integration` object with `satisfies Integration` (compliant with the typing read in Step 1) and aggregates the actions into a `Record` indexed by `action.id`, then `export default build<Name>Integration()`.
- An action (built by a `build<Name>Action()` factory) exposes `id`, `name`, `type` (`back`/`front`), `categories`, `icon`, `fields`, and an `aiMetadata` with `description` + `returns` (the shape of the result, as free text).
- Each field has its UI metadata (`label`, `type`, `bindable`, `bindingValidation`, `placeholder`, `options`) **and** its own `aiMetadata` (`type`, `description`, optional `example`) intended for the AI — including nested subsection fields and array `item` fields.
- An `IntegrationService` (core function) separates its AI metadata (`aiMetadata.name/description/path/inputSchema` in Zod) from its logic (`execute()`), and is typed with `IntegrationService<TParams, TResult>`.
- A real integration may need more (several actions in an `actions/` folder, static config, a Pinia store if reactive state is needed on the editor side) — only add these elements if the need is real, not by default.

## Step 3 — Create the integration folder

In `<weweb-editor>/src/_manager/integrations/<integration-name>/`, create at minimum these 3 files (mandatory for any integration). **Names must match the folder name** (the extractor relies on it):

| File                            | Role                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `index.ts`                      | Entry point / integration declaration (`build<Name>Integration()` + `satisfies Integration`)                             |
| `<integration-name>.service.ts` | Business logic / calls to the third-party service (typed `IntegrationService`)                                           |
| `<integration-name>.skill.md`   | Short, non-obvious guidelines & cross-action recipes only — **not** a re-listing of actions/fields (see Step 2 guidance) |

Other files may be needed depending on complexity. In `ai-gateway`, in addition to the 3 base files you find for example:

- a separate `*.utils.ts` file as soon as the logic shared between actions becomes substantial
- a `utils/common-fields.ts` file with shared field builders (`getProviderField`, `getModelField`, …)
- a `*-config.ts` file for static configuration (e.g. list of providers)
- a `*.store.ts` file (Pinia) — **required** as soon as any field has **dynamic `select` options** (a list fetched from the connection: databases, tables…); see [Dynamic `select` options](#dynamic-select-options-need-a-store) below
- an `actions/` folder when there are several actions

Only add these files/folders if the need is real (several actions, shared logic, dynamic state) — don't add them by default if the integration is simple.

### Dynamic `select` options need a store

A field whose options are fetched from the connection (databases, tables…) sets `options` to a function `({ connectionId, store }) => ({ isLoading, options: [{ label, value }] })`, and the integration declares `useStore: use<Name>Store` (a Pinia store). Contract the renderer expects:

- **`init({ connectionId, args })`** — loads the list; called once per (connection, `initArgs` tuple). Declare **`initArgs`** = the arg keys the options depend on, or `init` is deduped too aggressively.
- **`refresh({ connectionId, args })`** — re-fetch; called when rebuilding table columns.
- a per-field **`action`** (⟳ button) whose `onClick` re-fetches.

The store namespaces cached data by `connectionId` and exposes a `loading` map (fields read it for spinners). Real examples: `airtable`, `xano`.

Write all code in **TypeScript** — never `.js`.

**⚠️ Mandatory step, easy to forget**: once the folder is created, reference the new integration in the central registry:

```
<weweb-editor>/src/_manager/integrations/index.ts
```

Without this addition, the integration exists in its own folder but is **not** picked up by the editor (it won't appear anywhere, even if the code is otherwise correct). Import your integration and add it to the exported map, following the pattern used by the other entries. Also make sure your integration id is **not** in the `EXCLUDED_INTEGRATIONS` array of `extract-integrations.ts` (new integrations aren't, by default — just don't add it there).

## Step 4 — Code the actions, Event Triggers and Tables/Table views (if the integration has any)

> **Where things live — read first (this avoids the most common confusion).**
>
> - **The feature is always _defined_ in the editor.** The integration object in `<weweb-editor>/src/_manager/integrations/<name>/index.ts` is the single place that declares *what* the integration exposes (`actions`, `triggers`, `table`, …). This is true whether the feature runs in the front or the back of the app.
> - **The _execution code_ of a feature lives where it runs:**
>     - runs in the **front of the app** → `<weweb-editor>/src/_front/integrations/`
>     - runs in the **back of the app** → `<weweb-lambda-back-publisher>/server/src/integrations/`
>     - **core functions** — utilities used by the editor and the AI *during app development* (not at app runtime), e.g. to fetch context to configure an action → their execution code is in **weweb-back** (see Step 5).
>
> A fullstack feature has definition in the editor **and** execution code on more than one side — don't forget any of them.

### Lambda-back registration (shared by back actions, triggers and table views)

On the back, an integration is a folder `server/src/integrations/<name>/` whose files register their handlers into a global registry (`registry.ts` — **DO NOT MODIFY**) via three globals: `registerAction` (4.1), `registerHook` (4.2) and `registerTableView` (4.3).

The registry also exposes three Hono apps for mounting **HTTP routes**, differing by **context**:
- `global.public` — unauthenticated, served everywhere. **The one a normal integration needs** (webhooks, provider OAuth callbacks…). Used by `stripe`, `notion`.
- `global.editor` — editor context only, **not served on the published app** (also auto-resolves a `connection` passed in the request body). For editor-side management endpoints — used by `weweb-auth`.
- `global.app` — served on the published app. Rare: only for an integration exposing a runtime endpoint on the published app (today just `weweb-auth`'s `/auth/*`). Not needed by a typical integration.

Register them from a `<name>.routes.ts` wired in the barrel — e.g. `global.public.post(path, handler)` for a webhook (see §4.2).

**A back file only runs if it is imported** — two levels, both required:

1. `<name>/index.ts` — barrel importing each file of the integration:

    ```typescript
    // e.g. hello/index.ts
    import './hello.actions.ts';
    // import './hello.tableView.ts'; // only if it has one (4.3)
    // import './hello.hooks.ts';     // only if it has one (4.2)
    ```

2. `server/src/integrations/index.ts` — import the folder (one line, alphabetical):

    ```typescript
    import './hello/index.ts';
    ```

Miss either level and the handler silently never registers — no error, "nothing happens". This is the lambda-back equivalent of the editor's `_manager/integrations/index.ts` step.

> The snippets below use the fictional **Hello** integration from Step 2 (calling an imaginary "Greetings Cloud" API), for the same reason: never model new code on the excluded/legacy folders. For a real, current reference, `ai-gateway` is the one to open.

### 4.1 - Actions

**If the integration has no actions** (e.g. it only exposes core functions, or simple config/auth), skip directly to Step 6 (sync).

Per the preamble, front actions live in `_front/integrations/`, back actions in `server/src/integrations/` — a fullstack action needs both. On the back, an action registers a handler in `<name>/<name>.actions.ts` with `registerAction`:

```typescript
// hello/hello.actions.ts
global.registerAction('hello/messages-send', async ({ args }: ActionParams, context: ActionContext) => {
    // args    = the user-provided action parameters
    // context = { connection?: credentials of the installed connection, honoContext }
    const response = await fetch('https://api.greetings.example.com/v1/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${context.connection?.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: args.to, message: args.message }),
    });
    const data = await response.json();

    if (!response.ok) throw data; // with an SDK, let its errors propagate instead (e.g. `if (error) throw error;`)
    return data;
});
```

- **Action id**: `'<name>/<resource>-<action>'` (e.g. `hello/messages-send`). Must be globally unique — `registerAction` throws on a duplicate.
- **Credentials**: always via `context.connection?.<prop>` (optional chaining), prop names matching what the connection stores. Prefer the provider SDK over raw `fetch` when one exists.
- Wire the file through the barrel + registry (see [Lambda-back registration](#lambda-back-registration-shared-by-back-actions-triggers-and-table-views) above). Split into several `<resource>.<name>.actions.ts` files for large integrations.

### 4.2 - Code the Event Triggers

An event trigger is a **user-facing event** the integration exposes so the builder (or the AI) can attach a workflow to it. A trigger runs on the **front and/or the back** of the app — decided by its `types` (`'app'` = front, `'back'` = back; a trigger can be both). It is always **declared in the editor**, then **fired from wherever the event happens**, on the matching side.

**1. Editor side — declare the trigger(s)** on the integration object `triggers` array (shape = `integrationTriggerSchema` in `integration.type.ts`):

```typescript
triggers: [
    {
        label: 'On greeting sent',      // shown in the workflow trigger picker
        value: 'greeting-sent',         // trigger identity; fired as '<name>/<value>'
        description: 'Triggered after a greeting is sent',
        hint: 'Runs each time a greeting is sent — e.g. log it or notify someone.',
        types: ['app', 'back'],         // 'app' => front app-level workflows, 'back' => back event-trigger workflows
        event: { greeting: {} },        // FAKE sample payload for the workflow editor binding UI (object, or a function returning one)
        scopes: [],                     // optional tags/flags (see note)
    },
],
```

- **`event`** is **not** the runtime payload. It is a **fake/sample payload** surfaced in the workflow editor so the builder can bind the event's fields before any real event has fired (the real payload is the one you pass when firing, step 2). Usually a plain object; can be a function returning one when the sample must be computed (e.g. from a store).
- **`scopes`** are tags/flags with a UI/UX effect (in practice only `'auth'` today) — e.g. auth-scoped items are hidden unless the integration is the project's selected auth system. Leave empty unless the integration plays such a role.

**2. Fire the trigger where the event happens.** Fire `'<name>/<value>'` (matching the declared `value`); one site may fire several different triggers, or none.

- **Front (`types` includes `'app'`)** — from anywhere in the front integration code (`<weweb-editor>/src/_front/integrations/<name>/<name>.front.ts`): a front `hooks` handler (e.g. `init`, `auth-refresh`), or inside the integration's own **action code** — e.g. fire around every action to expose a common pre/post handler, or in a `catch` to expose an "on error" trigger:

    ```typescript
    import { executeWorkflows } from '@/_common/helpers/data/workflows.js';
    // inside a front hook/handler or action:
    await executeWorkflows('hello/greeting-sent', { event: { greeting } });
    ```

    The builder attaches logic by creating an **app-level workflow** — the trigger appears in the picker alongside "On app load", etc.

- **Back (`types` includes `'back'`)** — from the back integration code (`<weweb-lambda-back-publisher>/server/src/integrations/<name>/`): inside an action, a `registerHook` handler, or the integration's own webhook route:

    ```typescript
    import triggerCore from '../../core/trigger.core.js';
    await triggerCore.execute('hello/greeting-sent', { greeting }, { honoContext: c, socketId, editorUserId });
    ```

    The builder attaches logic by creating an **event-trigger workflow in the Back tab** of the editor.

**Actions can advertise the triggers they may fire.** An action definition can carry its own `triggers` array (or a function returning one) — each `{ value: '<name>/<value>', type, label, placeholder, required }` references a trigger the action is likely to fire, so the editor surfaces it next to the action and prompts the builder to handle it. Set `required: true` for a trigger the action expects to be handled.

**Back infra hooks.** `registerHook(hookType, 'integration:<name>', handler)` attaches code to an *existing* platform hook point (e.g. `auth-refresh`), fired via `hooksCore.execute`. Hooks are fixed infra (you can't add new ones) and are just one possible firing site — hook names and trigger names are unrelated, and a handler may fire zero, one or several triggers. A trigger declared but never fired shows in the UI and runs nothing.

**Webhook-driven back triggers.** More often a back trigger fires from the integration's **own public webhook route** (no hook involved). Add `<name>/<name>.routes.ts` (imported in the folder barrel) that registers on `global.public` (public = no auth, so the webhook is reachable), finds its connection(s) in `connections.json`, reads webhook secrets from `process.env[config.<key>.__envVariableKey]`, validates the signature, then fires:

```typescript
// hello/hello.routes.ts
import triggerCore from '../../core/trigger.core.js';
import CONNECTIONS from '../../data/connections.json' with { type: 'json' };

for (const connection of Object.values(CONNECTIONS).filter((c: any) => c.integration === 'hello')) {
    if (process.env[connection.config?.webhookEnabled?.__envVariableKey] !== 'TRUE') continue;
    const path = process.env[connection.config?.webhookPath?.__envVariableKey];
    const secret = process.env[connection.config?.webhookSecretKey?.__envVariableKey];
    if (!path || !secret) continue;

    global.public.post(path, async c => {
        const body = await c.req.text();
        if (!verifySignature(body, c.req.header('x-hello-signature'), secret)) return c.json({}, 400);
        const event = JSON.parse(body);
        await triggerCore.execute(`hello/${event.type}`, event.data, {
            socketId: c.req.header('ww-socket-id'), editorUserId: c.req.header('ww-editor-user-id'), honoContext: c,
        });
        return c.json({}, 200);
    });
}
```

(The `webhookEnabled` / `webhookPath` / `webhookSecretKey` config keys are declared in the connection component, §Step 2.) Only real reference: `stripe/stripe.routes.ts`.

> **Ship this route vs. let the user wire a public workflow?** Shipping the integration route is what turns a raw webhook into a **typed, signature-verified, reusable event trigger** every app gets for free (discoverable in the trigger picker, secret validated against the connection). It's the integration experience. The alternative — the builder creates a generic public/API workflow, copies its URL into the provider — needs no integration code but gives no typed trigger, no signature handling, and must be redone per app. Build the route when the event is a first-class feature of the integration; skip it (leave the generic workflow) for a one-off.

### 4.3 - Code the Tables/Table views

A **table view** exposes the integration's data as a paginated table for table components. Like triggers, it is **declared in the editor** and can run on the **front and/or the back**, decided by `table.type`: `'fullstack'` gives the builder a front/back toggle on the table (for services that can be queried directly from the browser), while a back- or front-only type restricts it. Implement a fetcher on **each side the table supports**; both return the **same `{ data, metadata }` shape**. Skip if the integration has no browsable data.

**1. Editor side — declare `table`** on the integration object (shape = `integrationTableSchema` in `integration.type.ts`): `type` (`'fullstack'` / back / front), `fields` (column config, each with `aiMetadata`), `view` (`{ fields, metadata }`), and `pagination` (`{ limit, fallbackLimit, maxLimit, offset }`).

**2. Back fetcher** (when `type` allows back) — create `<name>/<name>.tableView.ts` with a `registerTableView` handler, wired via the folder barrel:

```typescript
// hello/hello.tableView.ts
global.registerTableView('hello', async (connection: ConnectionConfig, table: TableConfig, view: ViewConfig) => {
    // connection = credentials ; table = resource/table config ; view = pagination/filters/sort
    const url = `https://api.greetings.example.com/v1/${table.resource}?limit=${view.limit || 50}&cursor=${view.offset || ''}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${connection?.apiKey}` } });
    const data = await response.json();

    if (!response.ok) throw data;
    return { data: data.items, metadata: { offset: data.next_cursor || null } };
});
```

`registerTableView('<name>', handler)` — one per integration; wire the file through the barrel (`import './<name>.tableView.ts';`).

**3. Front fetcher** (when `type` allows front) — add a `loadView` handler to the front integration code (`<weweb-editor>/src/_front/integrations/<name>/<name>.front.ts`), which queries the service directly from the browser and returns the **same shape**:

```typescript
// inside the front integration's default export:
async loadView({ tableConfig, viewConfig, parameters }) {
    // fetch directly from the front using the connection/client
    return { data, metadata: { offset, nextOffset, total } };
}
```

- **Return shape (both sides)**: always `{ data: [...], metadata: {...} }`. Put the provider's native pagination cursor in `metadata` (cursor/offset, `has_more`, total count, …), matching the editor `pagination.offset` key. Throw on an unsupported resource rather than returning empty data.

**4. Columns come from a table adapter — without it the table is EMPTY.** Rows and columns are two separate paths: rows = `table.view.data({ data })`, but **columns** come from `table.getTableAdapter` → `adapter.getFieldTree()`. `getTableAdapter` is **not** in the Zod schema, so omitting it raises no error — the table just renders **zero columns** (empty) even though the rows loaded. This is the #1 way to ship a broken-looking table while following every other step. Declare it on the editor `table` object:

```typescript
// hello/helloTableAdapter.ts
export function createHelloTableAdapter(context) {              // context = { connectionId, table, args, store, view }
    return {
        capabilities: { formulaColumns: false, inverseRelations: false, joinTypes: false },
        getFieldTree({ data } = {}) {                            // receives the RAW response rows (pre view.data)
            const keys = data?.[0] ? Object.keys(data[0]) : []; // or derive columns from a schema / the store
            return {
                fieldOptions: keys.map(k => ({ id: k, value: k, label: k, title: k, type: 'text' })),
                childrenLoader: null,
            };
        },
        getFilterConfig() { return {}; },
    };
}
// hello/hello.table.ts (editor):  getTableAdapter: createHelloTableAdapter
```

- **Data levels (the subtle part that causes the empty table):** the fetcher returns raw `{ data, metadata }` → `view.data({ data })` flattens it into the displayed **rows** → `getFieldTree` builds the **columns** and receives the **raw** `data`, **not** the flattened rows. So each `fieldOptions[].value` must match the keys of the rows produced by `view.data` (a cell reads `row[value]`). If `view.data` reshapes rows (e.g. `record => record.fields`) while the adapter infers keys off raw records, columns and cells won't line up. Real examples: `airtable` (columns from the connection store's schema), `http-request` (columns inferred from `data[0]`).

## Step 5 — Core functions (if the integration uses any)

Core functions are dev-time utilities the editor and the AI call to configure actions (e.g. list databases/tables to populate a dynamic `select`). The editor-side `<name>.service.ts` runs **client-side** and calls a weweb-back HTTP endpoint; the execution code lives in **weweb-back**, in a per-integration folder `integrations/<name>/` co-locating the controller and its route:

1. **Controller** — `<weweb-back>/integrations/<name>/<name>.controllers.js`.
2. **Route** — `<weweb-back>/integrations/<name>/<name>.routes.js`, then register it in `integrations/index.js`. Pattern:

    ```js
    app.route('/v2/projects/:projectId/integrations/<name>/<resource>')
        .post(
            verifyServiceOrFallback(newMdlw.usersMdlw.ensureAccess, newMdlw.designsMdlw.ensureAccess),
            integrationsMdwl.ensureConnection,     // reads req.body.connectionId → sets req.connection
            <name>Ctrl.getResource,
        );
    ```

3. The client posts `{ connectionId }`. The **`ensureConnection`** middleware (`middlewares/new/integrations.middlewares.js`) loads the connection and resolves each `__envVariableKey` onto `connection.config.<key>.editorValue`, setting `req.connection`. The controller then reads the token via `req.connection.config.<key>.editorValue`.

Miss the route + its registration in `integrations/index.js` and the core function is unreachable even if correctly coded. **weweb-back has its own `.claude/docs/integrations/` documenting this pattern — read it when working there.**

## Step 6 — Sync to weweb-ai

Once the integration is developed and working, run the extraction command from the root of `weweb-editor` (or the repo that hosts the script — check the `package.json` if needed):

```bash
npm run extract-integrations <absolute-path-to>/weweb-ai/src/core/data/integrations/files
```

**Critical points to watch:**

- The given path must point **all the way to the `files` folder included** in `weweb-ai/src/core/data/integrations/`. An incomplete path or one pointing to the wrong place will make the sync fail silently or produce a result in the wrong place.
- Always use the absolute path to the local `weweb-ai` requested in Step 0 — never guess a relative path.
- The extractor parses each integration through the Zod `integrationSchema`. If your integration doesn't follow the current conventions (missing `id`, wrong file names, malformed fields), it will fail to parse and be skipped — check the command output for warnings.
- This command syncs only integrations. Syncing native workflow actions uses a different command (`extract-native-actions`), covered by the separate skill `weweb-native-action-builder` — don't run it here.

### (Optional) Workflow Actions Linters

In `weweb-editor`, a field can be hidden dynamically and so, make the field not required even if `required: true` is set. When exported to `weweb-ai`, the field will always be verified as required because it can not dynamically compute required or hidden status. For this case, we need to override the `required` field in the `aiMetadata` of the field with `required: false`.
In that case, we can still do a verification in `weweb-ai` in a workflow linter for this specific action and programmatically do the verification in the workflow linter.

## Step 7 — Restart weweb-ai

After the extraction, **restart weweb-ai**: it may crash following the extraction (config reload mid-run). This restart is a mandatory step, not just an optional precaution — don't consider the work done until weweb-ai has restarted cleanly.

## Flow recap

```
0. Locate the 4 repos (ask the user)
1. Read integration.type.ts + integrationService.ts
2. Study the canonical reference: ai-gateway (then the Hello example here)
3. Create the integration folder + index.ts / <folder>.service.ts / <folder>.skill.md (TypeScript, factories, aiMetadata everywhere), THEN reference it in _manager/integrations/index.ts
4. Features are declared in the editor; execution code goes where it runs:
     - actions: front (_front/integrations) and/or back (server/src/integrations)
     - events:  declare `triggers` + fire '<name>/<value>' (front executeWorkflows / back triggerCore.execute)
     - tables:  declare `table` + a fetcher per supported side (back registerTableView / front loadView)
     - back:    wire each file via <name>/index.ts AND register the folder in server/src/integrations/index.ts
5. [if core functions] Add controller + route in weweb-back/integrations/<name>/ (register in integrations/index.js)
6. npm run extract-integrations <path>/weweb-ai/src/core/data/integrations/files
7. Restart weweb-ai
```

## Common pitfalls to watch for

- **Copying a legacy integration's *form*** (`.js`, plain `export default {}`, no `aiMetadata`) instead of following this skill / `ai-gateway`. Reading an older folder for its *mechanism* is fine and often necessary; copying its *shape* is the #1 mistake.
- Authoring `.js` files instead of `.ts`.
- File names not matching the folder name (`<folder>.service.ts` / `<folder>.skill.md`) — the extractor silently ignores them.
- Forgetting `aiMetadata` on an action, a field (including nested/item fields), or a service — the AI then can't use it.
- **Bloating the `.skill.md`** by re-listing actions/fields/return shapes or explaining generic knowledge (what the service is, how connections/API keys work). All of that already comes from `aiMetadata`; the skill file should only add non-obvious gotchas and cross-action recipes — keep it short (see the `<folder>.skill.md` guidance in Step 2).
- Returning a plain object from `index.ts` instead of a `build<Name>Integration()` factory with `satisfies Integration`, or forgetting `export default`.
- Forgetting an explicit `id` on the integration.
- Incomplete or relative path given to `extract-integrations` (must be absolute and point all the way to the `files` folder).
- Forgetting to reference the new integration in `_manager/integrations/index.ts` — without it, it's invisible to the editor even if the code is correct.
- Forgetting to code the front OR back side on a fullstack integration.
- **Table loads data but shows no columns** — you declared `table.fields` + a fetcher but no `getTableAdapter`. Columns come from the adapter's `getFieldTree` (fed the RAW rows), not from `fields`; without it, zero columns. (Observed on a real build — see Step 4.3.)
- Forgetting the route (and its registration in `integrations/index.js`) after adding a core-function controller — one without the other = inaccessible function.
- Forgetting to restart weweb-ai after extraction, and debugging a "it doesn't work" that is actually just a process to restart.
- Straying from the pattern observed in `ai-gateway` without reason — prefer consistency with the modern reference.

_Note: I don't have direct field feedback on other specific pitfalls observed with other devs — if you identify more after a first real test, we'll complete this list._
