---
name: svelte-loading
description: Implement fast, flicker-free data loading in ANY SvelteKit 2 + Svelte 5 app — streamed load functions, {#await} skeletons, depends/invalidate, hover/tap preload, an in-process cache for heavy queries, and the fatal Svelte-5 each_key_duplicate gotcha. Use when adding or fixing a SvelteKit page's loading, or when the user reports slow loads, flicker, "reloads several times", blank screens on navigation, stale data after a mutation, or an each_key_duplicate crash. Triggers on +page.js/+layout.js load, {#await}, depends(), invalidate(), data-sveltekit-preload-data, streamed promises.
disable-model-invocation: false
---

# SvelteKit Loading — portable production patterns

A reusable playbook for data loading in **any** SvelteKit 2.x + Svelte 5 project. These patterns are framework-general; they are **not** specific to one app. They were distilled from a production multi-tenant analytics app (**Orwel**), which serves as the reference implementation — wherever a pattern cites an `orwel/src/...` file, that's a worked example to study **if you have that repo**, not a dependency. The pattern itself transfers to any SvelteKit codebase.

**How to apply to a new project:** skim the four mental-model layers, then adopt patterns 1–6 as needed. Most projects need Patterns 1–3 + 5 + the Gotcha immediately; add Pattern 4 (cache) only when you have heavy/shared queries. Use the Adoption checklist at the end to retrofit an existing app.

## Rule 0 — Stream, never block

A `load` function must return **un-awaited promises** for anything heavy (DB queries, API fetches, aggregations). The page renders skeletons immediately and the UI resolves each promise with `{#await}`. Awaiting a heavy fetch inside `load` blocks the entire navigation — the #1 cause of "the page takes forever to appear".

Only `await parent()` (cheap, cached) and synchronous setup (building query strings) run before the `return`.

## Mental model — the load chain

SvelteKit runs `load` functions top-down; each can feed the next via `parent()`. A typical app has up to four layers — **the middle two are optional, adapt to your app**:

1. **Auth/session layer** — `src/hooks.server.ts` attaches the validated user/session to `event.locals`. (Auth-gated apps. Validate the token properly — e.g. with Supabase, call `getUser()`, not just `getSession()`.)
2. **Root client layer** — `src/routes/+layout.(ts|js)` builds the API/DB client and exposes session/user. `depends('app:auth')` so a re-login can invalidate it.
3. **Context layer (optional)** — a group layout like `src/routes/(app)/+layout.js` resolves cross-page context (tenant/workspace/org) once, so every child gets it via `parent()`. Skip this if your app has no such shared context.
4. **Page layer** — `+page.(js|server.js)` does `await parent()` for context, then returns **streamed promises**.

> `+page.js` (universal: runs on server then client) vs `+page.server.js` (server-only: for secrets, direct DB, non-serializable work). Stream from either — both support returning promises.

## Pattern 1 — The streamed `load` (canonical shape)

```js
/** @type {import('./$types').PageLoad} */
export async function load({ parent, fetch, url, depends }) {
	depends('app:items');                    // 1. register an invalidation key
	const { user } = await parent();          // 2. cheap parent context (await OK)

	// 3. guard / empty path: return a RESOLVED promise (or plain []), never undefined,
	//    so the consumer's {#await} branch stays uniform.
	if (!user) return { items: Promise.resolve([]) };

	// 4. cheap synchronous query-string build from the URL
	const qs = new URLSearchParams({ page: url.searchParams.get('page') ?? '1' });

	// 5. fire the fetch but DO NOT await — return the promise.
	const items = fetch(`/api/items?${qs}`)
		.then((res) => (res.ok ? res.json() : []))
		.catch((err) => {
			console.error('Failed to load items:', err);
			return []; // fail soft: page still renders
		});

	return { items };
}
```

**Fail-soft vs hard-fail — choose per route:**
- **List/dashboard pages** → `.catch(() => fallback)` so the page renders an empty state instead of erroring.
- **Detail pages / required data** → `throw error(status, msg)` (from `@sveltejs/kit`) and render the `{:catch}` branch.

*Reference: `orwel/src/routes/(app)/journeys/+page.js` (list, fail-soft), `.../journeys/[jid]/+page.js` (detail, throws on 404), `.../dashboard/+page.js` (multiple parallel streamed fetches).*

## Pattern 2 — Consuming the stream in `+page.svelte`

```svelte
<script>
	export let data;
	// data.items is a streamed Promise (or [] from the guard path).
	// Promise.resolve normalizes both into a thenable for {#await}.
	$: itemsPromise = Promise.resolve(data.items ?? []);
</script>

{#await itemsPromise}
	<ListSkeleton count={6} />            <!-- skeleton MUST mirror the resolved layout -->
{:then items}
	{@const total = items.length}         <!-- derive view-model values right here -->
	{#if items.length === 0}
		<EmptyState />
	{:else}
		{#each items as item (item.id)}…{/each}
	{/if}
{:catch err}
	<ErrorState message={err?.message} />
{/await}
```

- Put derived/aggregate values in `{@const}` inside `{:then}` — scoped to the resolved data, no second reactive layer.
- **One source of truth.** Don't also mirror the resolved value into a separate `let` fed by `promise.then(...)` and render from that — the two desync. Render straight from the `:then` binding.
- Skeletons must match the resolved layout (same grid/columns/heights) so there's zero layout shift.

## Pattern 3 — `depends()` + `invalidate()` (refetch without a full reload)

- Tag each load: `depends('app:items')`. Use a stable, namespaced string.
- After a mutation, refetch just that data: `await invalidate('app:items')` — re-runs only loads that declared that key. No full navigation, no flash.
- **Filter / sort / pagination changes**: update the URL, then invalidate — don't hard-navigate:
  ```js
  const next = new URL($page.url);
  next.searchParams.set('dateFrom', from);
  await goto(next, { replaceState: true, keepFocus: true, noScroll: true });
  await invalidate('app:items');
  ```
  `keepFocus` + `noScroll` + `replaceState` stop the page from jumping.

## Pattern 4 — In-process cache for heavy / shared queries (optional)

Add this only when multiple endpoints (or rapid re-requests) hit the same expensive, idempotent read. It gives a TTL cache **plus in-flight dedupe** (concurrent callers share one Promise → the query fires once). DB roles often have a statement timeout (e.g. 8s); dedupe prevents N identical heavy queries from racing into it. This utility is plain JS — **drop it into any project**:

```js
// src/lib/server/cache.js
const valueCache = new Map();   // key -> { expiresAt, value }
const inflight = new Map();     // key -> Promise

export async function cached(key, fetcher, ttlMs = 30_000) {
	const now = Date.now();
	const hit = valueCache.get(key);
	if (hit && hit.expiresAt > now) return hit.value;

	const existing = inflight.get(key);
	if (existing) return existing;                 // dedupe concurrent callers

	const p = (async () => {
		try {
			const value = await fetcher();
			valueCache.set(key, { expiresAt: Date.now() + ttlMs, value });
			return value;
		} finally {
			inflight.delete(key);
		}
	})();
	inflight.set(key, p);
	return p;
}

export function invalidatePrefix(prefix) {
	for (const k of valueCache.keys()) if (k.startsWith(prefix)) valueCache.delete(k);
}
```

- Errors are **not** cached (the `try` only stores on success), so a transient failure won't poison the cache.
- Cache is per-process (per serverless instance) — fine for eventual consistency; don't use it where you need strong cross-instance consistency.
- Purge after a mutation: `invalidatePrefix('items:')`.
- **Aggregate in the database, stream bounded rows.** Pushing summaries into a SQL function/aggregate beats pulling thousands of raw rows to reduce in JS (which OOMs at scale). Detail views should fetch a *capped* page of rows.

*Reference: `orwel/src/lib/intelligence/cache.js` (this exact utility), `orwel/src/lib/features/adoption.js` (the aggregate-in-SQL note).*

## Pattern 5 — Preload configuration

Set link-preload behavior on `<body>` (in `app.html`) and/or a wrapping element:

```html
<body data-sveltekit-preload-data="tap">
<!-- and on the app shell wrapper: -->
<main data-sveltekit-preload-data="tap" data-sveltekit-preload-code="hover">
```

- `preload-code="hover"` — on hover, prefetch the route's JS modules. Cheap, no data work. Keep this.
- `preload-data="tap"` — fetch the route's `load` data on mousedown/touchstart (≈100ms before click), **not** on hover.

Why not `preload-data="hover"`: hovering a link runs the target route's `load`. If any `load` in that chain has a side effect or is heavy, every hover visibly "recalculates"/reloads the view. `tap` keeps navigation instant without firing loads on hover. (Use `"hover"` only when all loads in scope are pure and cheap.)

## GOTCHA — Svelte 5 `each_key_duplicate` is FATAL

In **Svelte 5**, a duplicate key in a keyed `{#each}` is a hard runtime crash (`each_key_duplicate`) — Svelte 4 only warned. One crash kills the whole page render, which looks exactly like "the page won't load". This bites any Svelte 5 app.

**Never key `{#each}` on a value that can repeat or be null.** Key by index instead:

```svelte
{#each tags as t (t)}                 ✗  tags can repeat
{#each users as u (u.visitor_id)}     ✗  id can be null/duplicate
{#each days as d (d.label)}           ✗  formatted labels wrap (e.g. >1yr)

{#each tags as t, i (i)}              ✓
{#each users as u, i (i)}             ✓
```

Key by a real id `(item.id)` only when it's guaranteed unique and stable; otherwise use the index. (This and `{#await}` apply to plain Svelte SPAs too, not just SvelteKit.)

## Anti-patterns (each caused a real production bug)

- **Don't gate a full-screen branch on a global store set inside `load()`.** e.g. `isLoading.set(true)` in a layout load + `{#if $isLoading}<spinner/>` in the layout. Every invalidation (token refresh, context switch, filter change) then blanks the **entire** app to a spinner. Use per-section `{#await}` skeletons; never unmount the shell.
- **Don't `await` heavy fetches in `load`.** Blocks navigation. Stream them.
- **Don't pull raw rows to aggregate in JS.** OOMs at scale. Aggregate in the DB.
- **Don't key `{#each}` by data values.** See the gotcha.
- **Don't mirror a streamed value into a parallel `let`.** Render from the `{#await}` `:then`.

## Diagnosing a loading complaint (works on any project)

1. **"Doesn't load" / blank** → open the browser console FIRST. A Svelte runtime error (`each_key_duplicate`, undefined access in markup) crashes render and masquerades as a data problem. Then check Network for the request: pending (query timeout), 5xx (read the response + server log), or 200 with `[]` (genuinely empty → it's an empty-state, not a bug).
2. **"Reloads several times" / flicker on nav** → a global store toggled in a `load` gating a full-screen branch, OR `preload-data="hover"` running loads on hover.
3. **"Slow to appear"** → something is `await`ed in `load` that should be streamed.
4. **"Stale after I created X"** → missing `invalidate('<key>')` after the mutation (and/or an un-purged server cache).

## Adoption checklist — retrofit an existing SvelteKit app

- [ ] Move heavy `await`s out of `load`; return promises instead.
- [ ] Wrap each streamed value in `{#await}` with a layout-matching skeleton + `{:catch}`.
- [ ] Add `depends('<ns:key>')` to each load; call `invalidate(...)` after mutations and on filter/sort/page changes (via `goto` + `invalidate`, not hard nav).
- [ ] Audit every keyed `{#each}` — replace value/id keys that aren't guaranteed unique with index keys.
- [ ] Set `preload-code="hover"` + `preload-data="tap"`; remove any `preload-data="hover"` whose loads aren't pure.
- [ ] Remove any global-store full-screen spinner gated by a `load`.
- [ ] If endpoints share an expensive query, add the `cached()` utility and aggregate in the DB.

## Reference implementation (Orwel repo — illustrative)

If you have the Orwel repo, these are live, production examples of every pattern above:
- Streamed list load: `src/routes/(app)/journeys/+page.js`, `.../features/+page.js`
- Parallel multi-fetch streamed load: `src/routes/(app)/dashboard/+page.js`
- Detail load with hard error: `src/routes/(app)/journeys/[jid]/+page.js`
- `{#await}` + `{@const}` consumers: `src/routes/(app)/features/[fid]/+page.svelte`, `.../events/+page.svelte`
- Load chain: `src/hooks.server.ts`, `src/routes/+layout.ts`, `src/routes/(app)/+layout.js`
- Cache + aggregate-in-SQL: `src/lib/intelligence/cache.js`, `src/lib/features/adoption.js`
- Preload: `src/app.html`, `src/routes/+layout.svelte`
- Skeletons: `src/components/ui/{MetricSkeleton,CardGridSkeleton,ListSkeleton,ChartSkeleton}.svelte`

## Upstream docs (source of truth — training data is often wrong for Svelte 5)

- Load & streaming: https://svelte.dev/docs/kit/load · Streaming: https://svelte.dev/docs/kit/load#Streaming-with-promises
- `depends`/`invalidate`: https://svelte.dev/docs/kit/load#Rerunning-load-functions · `parent()`: https://svelte.dev/docs/kit/load#Using-parent-data
- Preload link options: https://svelte.dev/docs/kit/link-options
- Svelte 5 runes (`$state`/`$derived`/`$effect`/`$props`): https://svelte.dev/docs/svelte/what-are-runes
