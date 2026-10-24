---
name: ga4-setup
description: Set up Google Analytics 4 conversion tracking on a landing page end to end — read the landing, propose a tracking plan, instrument gtag events in code, register key events / custom dimensions / event-create rules in GA4 through the ops-hyper MCP, and verify with realtime data. Use when the user wants to configure GA4, Google Analytics conversions or key events for a landing or site, create conversion events automatically, check that GA4 events are arriving, or fix how Google Ads counts the landing's leads (primary/secondary, "Una" counting, duplicated GA4 rules). Triggers on "configura GA4", "Google Analytics en la landing", "eventos de conversión", "key events", "generate_lead", "measurement ID", "G-XXXX", "ga_setup_tracking", "tracking-plan.json", "conversiones de Ads", "recuento Una", "acción principal".
disable-model-invocation: false
---

# GA4 setup for landings

Turn a landing into a GA4 property with working conversions, without clicking through the GA UI. The work splits in two:

- **You (the agent)** read the landing, design the tracking plan and write the code that fires events.
- **The ops-hyper MCP** talks to the GA4 Admin API with Hyperdigital's credentials. Nobody needs Google credentials on their machine.

The GA4 Admin API only *configures* a property. It never fires events. Every conversion must come from the landing itself (gtag in code) or from an event-create rule on a URL (thank-you page).

## Requirements

The ops-hyper MCP must be connected and expose the `ga_*` tools:

```bash
claude mcp add --transport http ops-hyper https://ops.hyperdigital.mx/api/mcp --header "Authorization: Bearer <HYPER_MCP_KEY>"
```

Ask the Ops admin for the key. In claude.ai the same server is available as the "HyperOps" connector. Check with `ga_list_properties`; if it fails with a scope error, the server's Google token lacks `analytics.edit` — that is an Ops config issue, stop and report it.

| Tool | Writes | Use |
|---|---|---|
| `ga_list_properties` | No | Find the property or the account to create one in |
| `ga_tracking_config` | No | Current streams, measurement ID, key events, dimensions, rules |
| `ga_create_property` | Yes | New property + web stream, returns `G-XXXX` |
| `ga_setup_tracking` | Yes | Key events, custom dimensions, event-create rules (idempotent, never deletes) |
| `ga_delete_event_create_rule` | Yes | Delete an event-create rule; refuses anything but a self-copy unless `force` |
| `ga_realtime_events` | No | Verify events are arriving |
| `gads_get_conversion_actions` | No | Ads conversion actions of the client's account: type, counting, primary/secondary |
| `gads_create_conversion_action` | Yes | New Ads web conversion (`AW-` tag), when the landing reports to Ads directly |
| `gads_update_conversion_action` | Yes | Primary/secondary, counting (`ONE_PER_CLICK`), status, name |

Write tools default to `dry_run: true`. Always run the dry run, show the result, and only then call again with `dry_run: false`.

## Workflow

### 1. Resolve the property

- If the user gives a client, pass `client_id` (Ops resolves the linked property). If they give a property ID, use it.
- Otherwise run `ga_list_properties` and match by name. Never guess between two candidates — ask.
- No property yet: `ga_create_property` with the account, client/landing name and production URL. Dry run, confirm, apply. Save the returned measurement ID.
- Existing property: `ga_tracking_config` to get the measurement ID and see what is already configured.

### 2. Read the landing

Find, in code:

- **Existing analytics**: `gtag(`, `googletagmanager.com`, `GTM-`, `dataLayer`. If GA or GTM is already installed, reuse it. Never install a second tag — it double counts every event.
- **Forms** and how they submit (fetch, form action, third-party embed). Locate the success branch.
- **Contact links**: `wa.me` / `api.whatsapp.com`, `tel:`, `mailto:`.
- **Primary CTAs** (hero button, pricing, "agenda una llamada").
- **Thank-you pages** (`/gracias`, `/thank-you`) or success states.

### 3. Write the tracking plan and get approval

Create `tracking-plan.json` at the repo root from `templates/tracking-plan.json`. It is the source of truth: committed with the landing, reviewed in the PR, and safe to re-apply because `ga_setup_tracking` skips what exists.

Use GA4 recommended event names whenever one fits — Ads and the standard reports understand them without mapping:

| Interaction | Event | Key event |
|---|---|---|
| Lead form submitted successfully | `generate_lead` | Yes |
| WhatsApp / phone / email click | `contact` | Usually yes |
| Signup / account creation | `sign_up` | Yes |
| Purchase | `purchase` | Yes |
| Primary CTA click | `select_content` or custom `cta_click` | No |

Rules:
- **On an existing landing, keep the GA4 event names it already sends.** Google Ads conversion actions import GA4 events by name; renaming one silently drops that Ads conversion to 0. The recommended names below are for new landings or new events.
- If the landing also uses Orwel, fire GA4 from the same success helper as the Orwel conversion (see the `orwel` skill, "Landing pages: one success point"), so both tools always count the same leads.
- Event names: snake_case, start with a letter, max 40 chars.
- Mark as key event only what the business counts as a conversion. Two or three per landing, not every click.
- `generate_lead` fires on **confirmed success** (2xx response or thank-you page), never on button click.
- Parameters must never carry PII (email, phone, name). Google's terms forbid it and it gets the property flagged. Send `form_id`, `method`, `cta_location` instead.
- Register a custom dimension only for parameters someone will report on. Standard properties cap at 50 event-scoped dimensions.
- `ONCE_PER_EVENT` is the default counting method. Use `ONCE_PER_SESSION` only when a repeated submit in the same session should count once.

Show the plan to the user as a short table and wait for approval before touching code or GA.

### 4. Instrument the landing

Install gtag once, client-side, with the measurement ID from env so previews can point to a different property (or none):

| Framework | Env var |
|---|---|
| SvelteKit / Astro | `PUBLIC_GA_MEASUREMENT_ID` |
| Next.js | `NEXT_PUBLIC_GA_MEASUREMENT_ID` (or `<GoogleAnalytics>` from `@next/third-parties/google`) |
| Vite | `VITE_GA_MEASUREMENT_ID` |

If the var is empty, skip the tag instead of crashing. Add it to `.env.example`.

Base tag in the document head:

```html
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXX');
</script>
```

One helper, imported everywhere:

```js
export function track(name, params = {}) {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return
  window.gtag('event', name, params)
}
```

Call sites:

```js
const res = await fetch('/api/lead', { method: 'POST', body })
if (res.ok) track('generate_lead', { form_id: 'hero_form' })
```

```js
track('contact', { method: 'whatsapp', cta_location: 'floating_button' })
```

For links that navigate away (`wa.me`, `tel:`), fire the event in the click handler; gtag uses `sendBeacon`, so it survives the navigation.

SPAs (SvelteKit, Next App Router, Vite routers): GA4 enhanced measurement already sends `page_view` on history changes. Do not add manual `page_view` calls on top or pages double count.

When a form cannot be edited (third-party embed with a redirect), skip code and use an event-create rule on the thank-you URL instead (step 5).

### 5. Apply the GA4 configuration

1. `ga_tracking_config` — confirm current state. It flags event-create rules whose destination equals their source event (`form_submit` → `form_submit`). Each one duplicates every hit of that event, and Ads imports both. Delete them with `ga_delete_event_create_rule` (dry run first). The original event keeps its name, so the Ads import is not affected.
2. `ga_setup_tracking` with the plan's `key_events`, `custom_dimensions` and `event_create_rules`, `dry_run: true`. Show the table.
3. Same call with `dry_run: false`. Report created / existing / failed.

Event-create rule for a thank-you page (no code):

```json
{
  "destination_event": "generate_lead",
  "conditions": [
    { "field": "event_name", "comparison_type": "EQUALS", "value": "page_view" },
    { "field": "page_location", "comparison_type": "CONTAINS", "value": "/gracias" }
  ]
}
```

Key events can be registered before the event has ever been received. Do not wait for traffic.

### 6. Google Ads conversions

Every lead action in Ads must count the real lead once. Check with `gads_get_conversion_actions` and fix:

- **Counting `ONE_PER_CLICK`** for lead actions (forms, WhatsApp, calls); `MANY_PER_CLICK` is for purchases only. On `AW-` (WEBPAGE) actions use `gads_update_conversion_action`. On actions imported from GA4 the API refuses the change: tell the user to set "Una" in the Ads console (Objetivos → Conversiones → the action → Recuento).
- **One primary action per real lead.** If two actions measure the same submit (an event and a GA4 rule built from it, `generate_lead` plus the form event), set one to secondary with `primary_for_goal: false`.
- **Each campaign bids on its own leads.** When two brands share an Ads account, give each campaign a custom conversion goal with its own action; account-wide goals make one brand optimize to the other's leads.
- **The campaign's goals must include the action's category.** A primary `SUBMIT_LEAD_FORM` action does not count for a campaign whose goals are only `PURCHASE`.
- Dropping a duplicate or switching to `ONE_PER_CLICK` lowers the reported conversions to the real number. Say so in the report so nobody reads it as a drop in leads; Smart Bidding readjusts in 1 to 2 weeks.

### 7. Verify

Trigger each event on the running landing (local dev with the env var set, or the preview/prod URL), then:

```
ga_realtime_events  property=...  event_names=["page_view","generate_lead","contact"]
```

Realtime takes a few seconds to a minute. If an event is missing after a couple of minutes:

- Check the browser network tab for a request to `google-analytics.com/g/collect` with `en=<event>`.
- Ad blockers drop gtag. Test in a clean profile.
- Wrong measurement ID in env (compare with `ga_tracking_config`).

Standard reports and key event counts lag 24–48 h behind realtime. That is normal and not a failure.

On production, verify with a headless browser that intercepts the landing's backend, Orwel, `google-analytics.com/g/collect`, `googleadservices.com` and `facebook.com/tr` (see the `orwel` skill, "Automated check without side effects"): one invalid submit fires nothing, one valid submit fires each tool exactly once.

### 8. Report

Tell the user: property and measurement ID, events instrumented (file and line), key events registered, what realtime confirmed, and anything left manual.

## Out of scope (do manually, say so)

- **Google Ads import**: linking GA4 to Ads and importing key events as Ads conversions is done in the GA4 / Ads UI.
- **Counting of GA4-imported Ads actions** and Universal Analytics goals: the API cannot change them; console only.
- **Deleting or editing** key events and dimensions, and deleting event-create rules that are not self-copies. The tools only create, plus `ga_delete_event_create_rule` for self-copies.
- **Properties the Ops token cannot see.** If `ga_tracking_config` returns 403, the property has not granted the Ops Google account access; ask for Editor access on that property.
- **GTM containers**. If the site is GTM-only, propose moving the events into code or ask before touching the container.
- **Consent banners / Consent Mode**. Flag it if the landing targets the EU.
