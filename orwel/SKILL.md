---
name: orwel
description: Install, initialize, and fully instrument a project with the Orwel analytics SDK (npm package `orwel`), from install through proposing a business-event catalog, instrumenting the service layer, registering custom codes, and verifying with the development key and Dev mode. Use when the user wants to add Orwel tracking, integrate the Orwel SDK, instrument their app's business events, set up identify/track/conversion/monitor/session/form, define Orwel features/journeys, connect the Orwel MCP, or troubleshoot an Orwel install. Triggers on mentions of "Orwel SDK", "orwel.init", "orwel.track", "orwel.conversion", "PUBLIC_ORWEL_KEY", pasting an `orwel_...` key, or pasting Orwel ingest-debugger warnings (e.g. "event_not_found", "Event not found", HTTP 207 on /ingest/batch, "visitor_unresolved", "conversion_no_email", "missing_attribution").
disable-model-invocation: false
---

# Orwel SDK

Install and use the Orwel analytics SDK (`orwel` on npm, current target `^1.7.1`) in any frontend project. Orwel is a singleton: one instance per app, initialized once, imported anywhere.

A full engagement has five phases. **Phase 1, Install** is Steps 1 to 4 below. Then continue with **Phase 2, Propose the event catalog**, **Phase 3, Instrument the service layer**, **Phase 4, Register custom codes**, and **Phase 5, Verify** (sections after the install steps). If the user only asked for the install, stop after Phase 1 and offer the rest.

Docs: https://docs.orwel.io. Per-framework install pages: https://orwel.io/install/<framework> (nextjs, sveltekit, astro, vite, html, shopify, wordpress, webflow, lovable).

## Keys (know which one goes where)

| Key | Prefix | Use |
| --- | --- | --- |
| Public key | `orwel_pk_` (older workspaces: `orwel_` + UUID) | Production SDK. Can only send data. |
| Development key | `orwel_dev_` | Local and staging SDK. Same pipeline, but leads are stored as test data (`is_test`, "Dev" badge), no notification emails, no integrations, and every request appears live in the dashboard's **Dev mode** (`/dev-mode`) with errors and warnings. |
| API key | `orwel_sk_` | Server-side reads (REST API `/api/v1`, MCP `/mcp`), with scopes. **Never** put it in `orwel.init()` or in browser code. |

Recommend the development key for local `.env` and the public key in the production environment.

## Rule 0: API key in env, NEVER hardcoded (non-negotiable)

This rule overrides every code sample in the upstream README and onboarding UI, which paste the literal key for copy-paste convenience. In a real project, the key MUST come from an environment variable. Apply this even if the user pastes their key inline in chat.

**Required steps for every install:**

1. Add the key to `.env` (create the file if missing) using the framework's public-env convention:
   - **SvelteKit:** `PUBLIC_ORWEL_KEY=orwel_xxx`
   - **Next.js:** `NEXT_PUBLIC_ORWEL_KEY=orwel_xxx`
   - **Vite (React/Vue/Svelte plain Vite):** `VITE_ORWEL_KEY=orwel_xxx`
   - **Create React App:** `REACT_APP_ORWEL_KEY=orwel_xxx`
   - **Nuxt 3:** `NUXT_PUBLIC_ORWEL_KEY=orwel_xxx` (then read via `useRuntimeConfig().public.orwelKey`)
   - **Vue CLI:** `VUE_APP_ORWEL_KEY=orwel_xxx`
   - **Astro:** `PUBLIC_ORWEL_KEY=orwel_xxx`
   - **Plain HTML/CDN, Shopify, WordPress, Webflow:** there is no env in the browser. The public key can only send data, so it may go in the snippet itself; if the site has a build or server step, inject it there instead. Never paste an `orwel_sk_` key anywhere in the browser.
2. Add a `.env.example` entry with an empty value or placeholder so other devs know the var exists. Never put the real key in `.env.example`.
3. Make sure `.env` is in `.gitignore`. If it isn't, add it.
4. Read the var in code via the framework's secure import (see per-framework snippets below). Never inline the literal key.
5. If the var is missing at runtime, log a warning and skip `orwel.init()` rather than crashing.

If the user pastes a literal `orwel_...` key into chat, treat it as a secret: write it to `.env` for them, do NOT echo it back, and do NOT commit it.

## Step 1: Install the package

Use the user's package manager. Default to npm if unknown.

```bash
npm install orwel@latest
# or: yarn add orwel@latest
# or: pnpm add orwel@latest
```

Verify the version landed in `package.json` under `dependencies` (not `devDependencies`) and that it resolves to `1.7.1` or newer (`npm ls orwel`). If the registry resolves an older version (1.4.x), tell the user: `conversion()` is not async there, there are no click ids, and flushes above 100 events are lost. Do not silently write code that relies on 1.6+ behavior against an older install.

## Step 2: Create the wrapper module

Always wrap `orwel.init` in a small module rather than calling it inline at the entry point. The wrapper:
- reads the env var,
- guards against the var being missing,
- re-exports `orwel` so the rest of the app imports from one place.

`init()` takes an **object** (`orwel.init({ apiKey })`). Passing the key as a plain string throws `config must be an object`.

The canonical reference lives in the Orwel app repo at `orwel/src/lib/orwel.js`. It looks like this:

```js
// src/lib/orwel.js  (SvelteKit reference implementation)
import { orwel } from 'orwel';
import { PUBLIC_ORWEL_KEY } from '$env/static/public';

export function initOrwel() {
  if (!PUBLIC_ORWEL_KEY) {
    console.warn('PUBLIC_ORWEL_KEY is not defined. Orwel SDK will not be initialized.');
    return;
  }

  orwel.init({
    apiKey: PUBLIC_ORWEL_KEY,
    debug: true // remove or gate behind an env in production
  });
}

export { orwel };
```

### Per-framework wrapper templates

**Next.js (App Router)**, `lib/orwel.ts`:
```ts
'use client';
import { orwel } from 'orwel';

export function initOrwel() {
  const apiKey = process.env.NEXT_PUBLIC_ORWEL_KEY;
  if (!apiKey) {
    console.warn('NEXT_PUBLIC_ORWEL_KEY is not defined. Orwel SDK will not be initialized.');
    return;
  }
  orwel.init({ apiKey });
}

export { orwel };
```

Then in `app/layout.tsx`, call it from a small `'use client'` component mounted in the root layout (init must run in the browser).

**React + Vite**, `src/lib/orwel.ts`:
```ts
import { orwel } from 'orwel';

export function initOrwel() {
  const apiKey = import.meta.env.VITE_ORWEL_KEY;
  if (!apiKey) {
    console.warn('VITE_ORWEL_KEY is not defined. Orwel SDK will not be initialized.');
    return;
  }
  orwel.init({ apiKey });
}

export { orwel };
```

Call `initOrwel()` once in `main.tsx` before `ReactDOM.createRoot(...).render(...)`.

**Vue 3 + Vite**, `src/lib/orwel.ts`: same `import.meta.env.VITE_ORWEL_KEY` pattern; call `initOrwel()` in `main.ts` before `createApp(App).mount(...)`.

**Nuxt 3**, `plugins/orwel.client.ts`:
```ts
import { orwel } from 'orwel';

export default defineNuxtPlugin(() => {
  const apiKey = useRuntimeConfig().public.orwelKey as string | undefined;
  if (!apiKey) {
    console.warn('NUXT_PUBLIC_ORWEL_KEY is not defined. Orwel SDK will not be initialized.');
    return;
  }
  orwel.init({ apiKey });
  return { provide: { orwel } };
});
```
Add to `nuxt.config.ts`: `runtimeConfig: { public: { orwelKey: '' } }` (Nuxt fills it from `NUXT_PUBLIC_ORWEL_KEY`).

**Astro**, initialize from a client-only script, e.g. `src/components/OrwelInit.astro`:
```astro
---
const apiKey = import.meta.env.PUBLIC_ORWEL_KEY;
---
<script is:inline define:vars={{ apiKey }}>
  if (apiKey) {
    import('orwel').then(({ orwel }) => orwel.init({ apiKey }));
  } else {
    console.warn('PUBLIC_ORWEL_KEY is not defined. Orwel SDK will not be initialized.');
  }
</script>
```

**Plain HTML / CDN**:
```html
<script src="https://cdn.jsdelivr.net/npm/orwel@1/dist/orwel.umd.js"></script>
<script>orwel.init({ apiKey: 'orwel_pk_...' })</script>
```

## Step 3: Initialize as early as possible

Init must run **once**, **client-side**, **before** any `track`/`identify`/`conversion` call. SSR frameworks must guard against running on the server (on the server every SDK method is a no-op).

- **SvelteKit:** call `initOrwel()` from `+layout.svelte` inside `onMount(...)`.
- **Next.js:** dedicated `'use client'` component mounted in the root layout, calling `initOrwel()` in a `useEffect(() => { initOrwel(); }, [])`.
- **Vue/React (SPA):** call from `main.ts`/`main.tsx` before mounting.
- **Nuxt 3:** the `.client.ts` plugin filename guarantees client-only execution.

## Step 4: Use the SDK

Import the same `orwel` re-export everywhere; never re-init.

```ts
import { orwel } from '@/lib/orwel'; // or '$lib/orwel' in SvelteKit
```

### track: named events
```ts
orwel.track('quote_created', { amount: 1200, currency: 'MXN' });
```
Event codes must be `lowercase_snake_case`, at most 50 chars, letters/numbers/underscores only.

**The code must exist in the workspace catalog**: the Orwel catalog (a few hundred standard codes such as `page_view`, `signup`, `purchase`, `form_submit_success`) plus the custom codes the workspace registered. Any other code is rejected by the server with `Event not found: <code>` (see Phase 4 and Phase 5). Codes are NOT auto-registered on first ingest.

### identify: visitor traits
```ts
orwel.identify({
  email: 'user@example.com',
  plan: 'pro',
  company: 'Acme Inc',
});
```
The visitor ID is resolved by the server from a browser fingerprint and persisted in `localStorage` under `__orwel_visitor__`. Browser/platform info is auto-merged; user-provided traits win on conflict. Without an email the visitor stays anonymous.

### conversion: lead capture
Independent record with its own ID, enriched into a lead. Conversion codes are NOT gated by the catalog.

> **Async since 1.6:** `conversion` returns `Promise<{ success: boolean; reason?: string }>`. It waits up to 5 s for the visitor id (if it never resolves, nothing is sent and `reason` is `'visitor_unresolved'`), adds a client `conversionId` (UUID) so retries are deduplicated server-side, attaches the persisted first/last-touch `attribution` (UTMs + ad click ids), flushes immediately, and resolves with the acknowledged result (`reason` can also be `'delivery_failed'` or `'error'`). In a submit handler, `await` it **before** flipping any state that unmounts the form.

```ts
const { success, reason } = await orwel.conversion('newsletter_signup', {
  email: 'user@example.com',
  source: 'landing_page',
});
if (!success) console.warn('Orwel conversion not delivered', reason);
```
Use snake_case codes. Common codes: `newsletter_signup`, `demo_request`, `contact_form`, `whitepaper_download`.

**A lead conversion MUST carry an email or it is not enriched and its notification email is not sent.** The backend looks for an email in `properties` (`email`/`emailAddress`/`mail`/`userEmail`) or in the visitor's identity traits from a prior/simultaneous `orwel.identify({ email })`. Without one the conversion is still recorded, but no notification email is sent and CRM integrations such as HubSpot skip it. So every lead-capture form (contact forms, demo requests, **and WhatsApp/chat hand-off modals**) must collect an email and pass it in the conversion. Canonical pattern:

```ts
orwel.identify({ email, name, phone });
await orwel.conversion('whatsapp_lead', { email, name, phone, message });
```

**Value:** when a conversion has a monetary value, pass it as `{ amount, currency }` in the properties (`amount` numeric, `currency` an ISO code like `'MXN'`). It is stored with the lead, and payment signals (`amount`, `plan`, `order_id`, codes like `purchase`) move the visitor to the customer lifecycle stage.

> Older code may call `orwel.lead(...)`. That method no longer exists: replace it with `await orwel.conversion(...)`.

### Attribution (automatic)
The SDK captures `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `utm_id` and the ad click ids `gclid`, `gbraid`, `wbraid`, `fbclid`, `ttclid`, `msclkid`, `li_fat_id` (1.7.0+) from the landing URL (then hash query, then referrer), and keeps a first/last-touch object in `localStorage` (`__orwel_attribution`). No code needed. Recommend `utm_id={{campaign.id}}` on Meta ads and `utm_id={campaignid}` on Google so leads join campaign spend even after renames.

### session: per-session state
```ts
orwel.session({ activePage: 'checkout', cartValue: 99.99 });
orwel.session({ ended: true }, true); // pass final=true to mark session end
```

### monitor: passive instrumentation
```ts
orwel.monitor(); // errors, console, network and performance, all on
// or pick:
orwel.monitor({ performance: true, errors: true, console: true, network: false });
```
Web Vitals and memory monitoring are NOT enabled by `monitor()`.

### form: form interaction tracking
```ts
const form = document.getElementById('signup-form');
orwel.form(form, {
  formId: 'user_signup',
  trackFocus: true,
  trackInput: true,
  trackChange: true,
  trackSubmit: true,
  trackAbandon: true,
});
```
Wire up after the form element exists in the DOM (e.g. inside `onMount`/`useEffect`).

**Do not combine `orwel.form()` with a manual `orwel.conversion()` on submit.** Pick one path:

- **Manual conversion (recommended for lead forms / multi-step submits / Svelte/React/Vue with conditional rendering):** skip `orwel.form()` entirely. Call `orwel.identify()` + `await orwel.conversion('...')` inside your submit handler, **before** flipping any state that unmounts the form. See the troubleshooting section below.
- **Passive form analytics (informational forms, no custom submit logic):** use `orwel.form()` and let the SDK observe natively. Do not also call `orwel.conversion()` from the same submit, or you'll double-track.

In framework code with reactive bindings (Svelte `bind:value`, React controlled inputs), `orwel.form()` reads DOM attributes, not framework state. `fields_filled` may report `[]` even when inputs visibly contain values; rely on `fields_changed`/`fields_focused` instead if you keep `orwel.form()`.

### Section visibility (no JS needed)
Add `data-orwel-section="hero-banner"` to any element. The SDK auto-tracks visibility duration, max % visible, word count, and clicks/scrolls, rolled up into the session.

### flush: force-send queued events
```ts
await orwel.flush(); // rarely needed; auto-flushes when the tab hides and on unload
```
Since 1.7.1 the queue is sent in chunks of 100 events (the server's batch limit).

## Phase 2: Propose the business-event catalog

Auto-capture (page views, clicks, scroll, sections) is free; **business events are where the value is**, and they should be designed before writing a single `track()` call.

1. **Read the host codebase**, not the components: the service layer, API routes, stores/mutations, payment handlers. You're looking for the moments where business state changes (something created, submitted, published, paid, invited, completed).
2. **Propose a catalog of 10 to 30 codes**, snake_case, one per business action. Prefer standard Orwel catalog codes when one fits (`signup`, `purchase`, `begin_checkout`, `share`...); use custom codes for product-specific actions. Organize it on the value ladder so coverage is deliberate, not accidental:
   - **Tier 0, Reach**: arrived at the surface (usually covered by auto page_view; rarely needs custom codes)
   - **Tier 1, Activation**: first meaningful action (`account_created`, `first_project_created`)
   - **Tier 2, Core loop**: the repeated action the product exists for (`quote_created`, `task_completed`)
   - **Tier 3, Outcome**: the business result (`payment_completed`, `contract_signed`); these are usually `conversion()`, not `track()`
   - **Tier 4, Health**: signals whose *growth* is a warning (`error_shown`, `support_requested`)
3. **Present the catalog to the developer for confirmation** before instrumenting, as a table: code, tier, where it fires (file/function), track vs conversion, properties (including `{amount, currency}` on paid outcomes), and whether it is a standard or custom code. Do not instrument an unconfirmed catalog.

## Phase 3: Instrument the service layer

Instrument at the **service/mutation layer, not scattered across components**: one call site per business action, where the action actually succeeds.

- Put `orwel.track('code', {...})` immediately after the state change succeeds (after the API/DB call resolves), never optimistically before.
- `orwel.conversion()` must be **awaited**, and fired **before** any state flip that unmounts the surrounding UI (see the form troubleshooting section).
- Pass `{ amount, currency }` on revenue-bearing conversions.
- Placement per framework follows the wrapper-module pattern from Phase 1: import `orwel` from the wrapper (`$lib/orwel`, `@/lib/orwel`, the Nuxt plugin provide) inside services/stores. In SvelteKit that's `src/lib/services/` or form actions' client callbacks; in Next.js, client-side mutation hooks or the success callbacks of server actions; in Vue/Nuxt, Pinia actions. Never call `track` from a server-only context: the SDK is a browser client and every method is a no-op on the server.
- Add a guard against double-fire on retried mutations (only track on the first success).

## Phase 4: Register custom codes

The ingest rejects any `track()` code that is not in the workspace catalog. There is no automatic registration and no MCP tool to register codes. Custom codes are registered from the dashboard:

1. Tell the user to open **Journeys setup** (`/developers/journeys`) or **Features setup** (`/developers/features`) in the dashboard's Development section.
2. Add each custom code to the journey or feature it belongs to (event picker, **Custom event**, **Register and add**) and **save**. Saving registers the code for that workspace; the ingest accepts it from then on.
3. Standard catalog codes need no registration.
4. Optionally, the user can design journeys/features first in the dashboard and copy the **Implement** tab's **Agent prompt** or **TypeScript** module back to you: it lists every configured code, when to fire it, and how to verify it.

Journey funnels count steps in any order within the period, so build them from milestones that only happen as real progress; navigation-noise funnels (page_view then click) complete almost always and say nothing.

## Phase 5: Verify

- Run the app with the **development key** (`orwel_dev_...`) and `debug: true`, exercise one action per tier, and ask the user to open **Dev mode** (`/dev-mode`). Every request appears live with errors (`event_not_found`, `invalid_field`, `missing_session_id`, `session_not_found`, `invalid_batch`, `payload_too_large`, `unsupported_type`) and warnings (`code_format`, `conversion_no_email`, `conversion_no_id`, `missing_attribution`, `sdk_outdated`, `identify_no_email`). `test_mode_integrations_skipped` is expected with the dev key.
- Browser console (SDK 1.7.1): a rejected request (HTTP 400) logs `Event rejected (400) - DISCARDED, not retrying` or `Batch rejected (400) - events DISCARDED, not retrying` with the server response and the rejected codes. Rejected events are not retried.
- A batch with some unknown codes answers **HTTP 207** with the refused events in `failedEvents`; the SDK counts it as delivered and does NOT log it, so check Dev mode for those. If every event in a batch fails, the server answers 500.
- The **Status** tab of Journeys/Features setup shows per code: Receiving (production traffic), Tested (dev key), No data yet, Not registered, Rejected.
- Check that `await orwel.conversion(...)` resolves `{ success: true }` for a test lead with an email, and that a visit with `?utm_source=test` produces no `missing_attribution` warning.
- Before go-live, switch the production environment to the public key.

## Optional: Orwel MCP for agents

Orwel exposes a remote MCP server at `https://api.orwel.io/mcp` (streamable HTTP). It authenticates with `Authorization: Bearer orwel_sk_...`, an API key created in **Settings, API keys** with the `mcp` scope, and needs an active subscription. It is scoped to that key's workspace. Tools: `get_workspace_context`, `search_leads`, `get_lead`, `get_lead_analytics`, `get_visitors`, `get_conversions`, `get_campaigns`, `get_issues_and_signals`, `manage_lists`, `create_lead`, `send_lead_to_hyperflow`. It reads data and manages lists/leads; it does not register event codes or define journeys/features.

```bash
claude mcp add --transport http orwel https://api.orwel.io/mcp --header "Authorization: Bearer orwel_sk_..."
```

## Validation rules (the SDK enforces these at runtime)

- `apiKey` must start with `orwel_` and be at least 20 chars.
- `config`, `traits` and `properties` must be objects.
- Event codes: `^[a-z0-9_]+$`, at most 50 chars.
- Emails inside `properties` and traits are validated: pass valid addresses or omit the field. On **lead conversions**, omitting the email is not free (see the `conversion` section above).
- Invalid params throw with descriptive messages; surface them to the user instead of swallowing.

## Common init options

```ts
orwel.init({
  apiKey,                  // from env, never inline
  autoMonitor: true,       // same as monitor(): errors, console, network, performance
  autoEventDetection: true, // default true; automatic page_view/click/scroll and more
  debug: import.meta.env.DEV, // or process.env.NODE_ENV !== 'production'
});
```

## Troubleshooting

### `form_abandon` fires on a successful submit (instead of `conversion`)

Symptom: after a successful submit you see a `form_abandon` event in the Orwel dashboard with `abandon_reason: navigation`, `fields_filled: []`, and the conversion event is missing.

Root cause: `orwel.form(form, { trackAbandon: true })` watches for the `<form>` element leaving the DOM and labels it as abandonment. In frameworks that render the success state by **replacing** the form (Svelte `{#if submitted}` / `{:else}`, React conditional render, Vue `v-if`), the form unmounts the moment you flip the success flag, and the SDK can't tell that apart from real abandonment. Compounding this, `fields_filled` is empty because the SDK reads DOM attributes, not the framework's reactive state.

Fix:

1. **Remove `orwel.form()` from forms that have a custom submit handler with a conversion.** Track only what you need explicitly:
   ```ts
   async function handleSubmit(e: Event) {
     e.preventDefault();
     submitting = true;
     await api.submit({ ... }); // your real submit

     // Fire BEFORE the re-render that unmounts the form
     orwel.identify({ email, name, phone });
     await orwel.conversion('quote_request', { email, source: 'landing_page' });

     submitting = false;
     submitted = true; // safe to unmount now
   }
   ```
2. If you genuinely need both passive form analytics AND a manual conversion, keep `orwel.form()` but disable the conflicting flags: `trackAbandon: false, trackSubmit: false`.
3. Never call `orwel.conversion()` after the state change that unmounts the form.

### `conversion()` resolves `{ success: false }`

- `visitor_unresolved`: the visitor id did not resolve within 5 s. Make sure `init()` runs early on every page, before the form can be submitted, and that requests to `api.orwel.io` are not blocked (ad blockers, strict CSP `connect-src`).
- `delivery_failed`: sent but not acknowledged. Check the console with `debug: true` and the request in Dev mode.

### Events never arrive / `Event not found` / HTTP 207

The code is not in the workspace catalog. Register it (Phase 4) or switch to a standard catalog code. Conversions are not affected.

### `fields_filled: []` even though the form had values

Same DOM-vs-framework-state mismatch as above. If you need accurate field-fill telemetry, pass the values explicitly via `orwel.track(...)` from your own handlers instead of relying on `orwel.form()`.

## Pre-flight checklist before declaring the install done

- [ ] `orwel` is in `dependencies` in `package.json` and resolves to 1.7.1 or newer.
- [ ] `.env` contains the framework-correct public env var (dev key locally, public key in production).
- [ ] `.env.example` has a placeholder line for the same var.
- [ ] `.env` is gitignored.
- [ ] A wrapper module reads the env var, guards against missing, and re-exports `orwel`.
- [ ] `orwel.init({ apiKey })` is called exactly once, client-side, before any tracking call.
- [ ] No `orwel_...` literal appears anywhere in committed source (except the public key in no-build HTML snippets), and no `orwel_sk_` key is in browser code.
- [ ] Every custom `track()` code is registered (Phase 4); every lead `conversion()` is awaited and carries an email.
- [ ] Dev mode shows no errors for the exercised actions.

## Reference

- The Orwel app repo (`orwel/`) is itself an Orwel install: `src/lib/orwel.js` (wrapper), `src/lib/install/prompt.js` (install prompt per framework, including dev vs public key handling).
- SDK source and runnable examples live in `orwel-sdk/` (`src/`, `CHANGELOG.md`, `examples/`).
- Docs: https://docs.orwel.io (SDK, Dev mode, Journeys and features setup, Attribution, Troubleshooting, MCP).
