---
name: orwel
description: Install, initialize, and use the Orwel analytics SDK (npm package `orwel`) in a project. Use when the user wants to add Orwel tracking, integrate the Orwel SDK, set up identify/track/conversion/monitor/session/form, or troubleshoot an Orwel install. Triggers on mentions of "Orwel SDK", "orwel.init", "orwel.track", "PUBLIC_ORWEL_KEY", or pasting an `orwel_...` API key.
disable-model-invocation: false
---

# Orwel SDK

Install and use the Orwel analytics SDK (`orwel` on npm, current target `^1.4.4`) in any frontend project. Orwel is a singleton — one instance per app, initialized once, imported anywhere.

## Rule 0 — API key in env, NEVER hardcoded (non-negotiable)

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
   - **Plain HTML/CDN:** there is no env in the browser — inject the key at build/server time (e.g. via a `<meta>` tag rendered server-side, or a generated `config.js`). Never paste a literal key into a committed `.html` file.
2. Add a `.env.example` entry with an empty value or placeholder so other devs know the var exists. Never put the real key in `.env.example`.
3. Make sure `.env` is in `.gitignore`. If it isn't, add it.
4. Read the var in code via the framework's secure import (see per-framework snippets below). Never inline the literal key.
5. If the var is missing at runtime, log a warning and skip `orwel.init()` rather than crashing.

If the user pastes a literal `orwel_...` key into chat, treat it as a secret: write it to `.env` for them, do NOT echo it back, and do NOT commit it.

## Step 1 — Install the package

Use the user's package manager. Default to npm if unknown.

```bash
npm install orwel
# or: yarn add orwel
# or: pnpm add orwel
```

Verify the version landed in `package.json` under `dependencies` (not `devDependencies`).

## Step 2 — Create the wrapper module

Always wrap `orwel.init` in a small module rather than calling it inline at the entry point. The wrapper:
- reads the env var,
- guards against the var being missing,
- re-exports `orwel` so the rest of the app imports from one place.

The canonical reference lives in this repo at `orwel/src/lib/orwel.js` — read it before adapting to a different framework. It looks like this:

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

**Next.js (App Router)** — `lib/orwel.ts`:
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

**React + Vite** — `src/lib/orwel.ts`:
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

**Vue 3 + Vite** — `src/lib/orwel.ts`: same `import.meta.env.VITE_ORWEL_KEY` pattern; call `initOrwel()` in `main.ts` before `createApp(App).mount(...)`.

**Nuxt 3** — `plugins/orwel.client.ts`:
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

**Astro** — initialize from a client-only script, e.g. `src/components/OrwelInit.astro`:
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

## Step 3 — Initialize as early as possible

Init must run **once**, **client-side**, **before** any `track`/`identify`/`conversion` call. SSR frameworks must guard against running on the server.

- **SvelteKit:** call `initOrwel()` from `+layout.svelte` inside `onMount(...)`. (See `orwel/src/routes/(auth)/+layout.svelte` and `orwel/src/routes/+page.svelte` for live examples in this repo.)
- **Next.js:** dedicated `'use client'` component mounted in the root layout, calling `initOrwel()` in a `useEffect(() => { initOrwel(); }, [])`.
- **Vue/React (SPA):** call from `main.ts`/`main.tsx` before mounting.
- **Nuxt 3:** the `.client.ts` plugin filename guarantees client-only execution.

## Step 4 — Use the SDK

Import the same `orwel` re-export everywhere — never re-init.

```ts
import { orwel } from '@/lib/orwel'; // or '$lib/orwel' in SvelteKit
```

### track — named events
```ts
orwel.track('button_click', { button_id: 'submit_form' });
orwel.track('page_view', { path: '/checkout' });
```
Event codes must be `lowercase_snake_case`, ≤50 chars, letters/numbers/underscores only.

### identify — visitor traits
```ts
orwel.identify({
  email: 'user@example.com',
  plan: 'pro',
  company: 'Acme Inc',
});
```
Visitor ID is auto-generated and persisted in `localStorage` under `__orwel_visitor__`. Browser/platform info is auto-merged; user-provided traits win on conflict.

### conversion — lead capture
Independent record with its own ID, separate from the visitor.
```ts
orwel.conversion('newsletter_signup', {
  email: 'user@example.com',
  source: 'landing_page',
  campaign: 'winter_sale',
});
```
Use snake_case codes. Common codes: `newsletter_signup`, `demo_request`, `contact_form`, `whitepaper_download`.

> Older code may use `orwel.lead(...)` — `conversion` is the current name; treat them as equivalent if you see both.

### session — per-session state
```ts
orwel.session({ activePage: 'checkout', cartValue: 99.99 });
orwel.session({ ended: true }, true); // pass final=true to mark session end
```

### monitor — passive instrumentation
```ts
orwel.monitor(); // enable everything
// or pick:
orwel.monitor({ performance: true, errors: true, console: true, network: false });
```
Web Vitals and memory monitoring are NOT enabled by `monitor()` — they require manual setup if needed.

### form — form interaction tracking
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

### Section visibility (no JS needed)
Add `data-orwel-section="hero-banner"` to any element. The SDK auto-tracks visibility duration, max % visible, word count, and clicks/scrolls.

### flush — force-send queued events
```ts
await orwel.flush(); // rarely needed; auto-flushes on page unload
```

## Validation rules (the SDK enforces these at runtime)

- `apiKey` must start with `orwel_` and be ≥20 chars.
- Event codes: `^[a-z0-9_]{1,50}$`.
- Emails inside `properties` are validated — pass valid addresses or omit the field.
- Required params throw with descriptive messages; surface them to the user instead of swallowing.

## Common autoMonitor + debug options

```ts
orwel.init({
  apiKey,                  // from env, never inline
  autoMonitor: true,       // enable performance/errors/console/network monitoring
  autoEventDetection: true,
  debug: import.meta.env.DEV, // or process.env.NODE_ENV !== 'production'
});
```

## Pre-flight checklist before declaring the install done

- [ ] `orwel` is in `dependencies` in `package.json`.
- [ ] `.env` contains the framework-correct public env var with the real key.
- [ ] `.env.example` has a placeholder line for the same var.
- [ ] `.env` is gitignored.
- [ ] A wrapper module reads the env var, guards against missing, and re-exports `orwel`.
- [ ] `orwel.init` is called exactly once, client-side, before any tracking call.
- [ ] No `orwel_...` literal appears anywhere in committed source.
- [ ] If you can run the app: open the browser console and confirm no "PUBLIC_ORWEL_KEY is not defined" warning, and that init runs without validation errors.

## Reference

- This repo (`orwel/`) is itself an Orwel install. Use it as the canonical example: `src/lib/orwel.js` (wrapper), `src/routes/(auth)/+layout.svelte` and `src/routes/+page.svelte` (init call sites), `src/components/onboarding/SdkInstallation.svelte` (per-framework copy/paste snippets — note these intentionally show literal keys for the onboarding UI, but real installs MUST use env vars).
- SDK source and runnable examples live at `orwel-sdk/` (`examples/usage_example.ts`, `examples/form_tracking_example.html`, `examples/validation_example.ts`).
- Public docs: https://orwel.io/events for the standard event catalog.
