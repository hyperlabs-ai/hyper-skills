---
name: pixel
description: Install and configure the Meta (Facebook) Pixel in any frontend project, with PageView firing automatically and a Lead event wired into every form/conversion action on the site (quote forms, WhatsApp forms, contact forms, etc). Use when the user asks to "add the Meta Pixel", "configura el pixel de Meta", "instala el pixel de Facebook", pastes a Meta Pixel ID, or asks to track leads/conversions for Meta Ads.
disable-model-invocation: false
---

# Meta Pixel

Install the Meta Pixel base code once per project, then wire it into every conversion point automatically. Two events are always configured by default and never skipped:

1. **PageView** — fires once per page load, part of the base pixel snippet.
2. **Lead** — fires on the submit/completion of **every** form or form-like conversion action in the site (quote requests, WhatsApp lead forms, contact forms, callback requests, etc). By default treat all of them as the same `Lead` event — don't invent a different event name per form. The one exception is a form that is genuinely a different kind of conversion (e.g. a newsletter/lead-magnet signup) *and* the user explicitly wants it reported separately — then use `CompleteRegistration` for that one (see Step 4).

## Step 1 — Get the Pixel ID

Ask the user for the Meta Pixel ID if it isn't already provided in the conversation (a 15–16 digit number, e.g. `123456789012345`, found in the client's Meta Business → Events Manager → Data sources → the pixel). If the codebase already has a Pixel snippet installed with an ID, reuse that ID — don't ask again, don't introduce a second pixel.

**Each client has its own pixel.** Never copy an ID from another landing, an example or this skill: a copied ID sends one client's leads to another client's pixel and both campaigns optimize on the wrong data. Before using an ID, confirm it belongs to this client (the user, or the client's Events Manager). If you have other landings at hand, check that no other client's site uses the same ID.

The Pixel ID is not a secret (it's visible in every page's source/network requests), so hardcoding it directly in the base snippet is acceptable and is the common pattern. Only pull it from an env var if the project already manages similar public IDs that way (e.g. it already does this for GA4's Measurement ID) — match the existing convention, don't invent a new one.

## Step 2 — Install the base code, in the right place

Insert the standard Meta Pixel base snippet:

```html
<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('set', 'autoConfig', false, 'PIXEL_ID_HERE');
fbq('init', 'PIXEL_ID_HERE');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=PIXEL_ID_HERE&ev=PageView&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->
```

### Why `autoConfig` is set to `false`

The `fbq('set', 'autoConfig', false, ...)` line (placed **before** `init`) disables Meta's automatic event detection. By default the Pixel watches every button click and heuristically classifies some of them as standard events (like `Lead`) with no code involved. On a lead-gen landing this backfires badly: clicks that are NOT conversions — a modal's close (X) button, a backdrop click, a "cerrar" button, navigation — get auto-classified as `Lead`, so the site reports phantom leads on essentially any interaction. Turning `autoConfig` off means **only the events you fire explicitly in code count**, which is exactly what you want when wiring events by hand as this skill does. Keep it off unless the user specifically wants Meta's automatic button-click detection.

Where it goes, per stack:

- **SvelteKit** — `src/app.html`, inside `<head>`.
- **Next.js** — root layout (`app/layout.tsx`), or via `next/script` with `strategy="afterInteractive"`.
- **Nuxt** — `nuxt.config` `app.head.script`, or a plugin.
- **Plain HTML / static site** — every page's `<head>`, or a shared header partial if the site has one.
- **WordPress / CMS** — theme's `header.php` (or a snippet plugin / GTM if the client already uses one — see the "GTM" note below).

### Critical placement rule — charset must come first

`<meta charset="utf-8" />` (or the framework's equivalent) MUST be the very first element inside `<head>`, before the Pixel snippet, before GA/gtag, before anything else. Browsers only scan the first ~1024 bytes of the document for a charset declaration; if analytics scripts get inserted above it, the charset tag gets pushed past that window and the browser guesses the wrong encoding before it ever sees the real one. Symptom: accented characters render as mojibake (e.g. "precisión" shows as "precisiÃ³n") even though the source file and the meta tag are both correct UTF-8.

So the required order at the top of `<head>` is:

```html
<head>
	<meta charset="utf-8" />

	<!-- then GA/gtag, Meta Pixel, and any other third-party scripts -->
	...
</head>
```

If you find an existing `<head>` where analytics scripts were added above the charset meta tag, move the charset tag back to the top — this is a real bug to fix, not a style nitpick.

## Step 3 — Wire Lead into every form/conversion action

This is the part that requires actually reading the codebase, not just pasting a snippet. Find every conversion point:

1. Search for every `<form>` element and its submit handler (`on:submit`, `onSubmit`, plain `action=`/`method=` forms, etc).
2. Also search for "form-like" conversions that aren't a literal HTML form but still collect intent and hand off to an external channel — e.g. a modal that collects name/phone/message and then opens a `wa.me` WhatsApp link, a "book a call" button that opens Calendly, a newsletter signup. Treat the point where the user's data/intent is actually submitted as the Lead trigger.
3. For each one, add a single line right next to any existing analytics call (gtag, GTM dataLayer.push, etc) inside the submit handler — don't replace existing analytics, add alongside it. If the landing also uses Orwel or GA4, fire `Lead` from the same success helper as the Orwel conversion and the GA4 event (see the `orwel` skill, "Landing pages: one success point"), so every tool counts the same leads:

```js
fbq('track', 'Lead', { content_name: '<project-slug>-cotizacion' });
```

**Guard the call so a blocked pixel never breaks the handler.** The base snippet defines `window.fbq` synchronously, so normally `fbq` exists by the time a handler fires — but an ad/tracker blocker can strip the inline snippet entirely, leaving `fbq` undefined. A bare `fbq(...)` then throws a `ReferenceError`, and if that call sits before critical logic (e.g. a modal handler that fires Lead and *then* runs `window.open('https://wa.me/...')`), the throw aborts the redirect and the real conversion is lost. Guard it:

```js
if (typeof fbq !== 'undefined') fbq('track', 'Lead', { content_name: '<project-slug>-cotizacion' });
```

Put the guarded Pixel call so it can't block the handoff — either after the `window.open`/redirect line, or wrapped as above. Match whatever error-handling the surrounding handler already uses (e.g. if it's inside a `try/catch`, a bare call is already safe).

Use one consistent `content_name` per project (derive it from the project/client name, kebab-case, e.g. `transportes-bac-cotizacion`), the same value across every form in that project, unless the user asks to distinguish forms from each other (in which case make `content_name` per-form, e.g. `transportes-bac-cotizacion-hero` vs `transportes-bac-cotizacion-whatsapp`).

   **Fire `Lead` only on confirmed success, exactly once.** If the form posts to a backend, fire it when the response is 2xx, never on the button click or before validation: an invalid or failed submit is not a lead. One call per action: no second listener (an `onclick` plus an `onsubmit`, a GTM trigger, a codeless event) firing the same `Lead`.

4. A button that merely **opens** a form/modal (no data submitted yet) is not a Lead — don't fire Lead there. If the user wants that lighter intent signal tracked too, that's what `Contact` is for (see below), not `Lead`.

   **Exception — WhatsApp conversions always fire `Lead`.** Every WhatsApp conversion on the site counts as a Lead. But fire it at the point of **submission/send**, not when the button merely opens the modal:
   - WhatsApp button that opens a modal collecting data → fire the guarded `Lead` on the **modal form's submit** (next to the `window.open('wa.me/...')` handoff), NOT on the button click that opens the modal.
   - WhatsApp button/link that jumps **straight** to `wa.me` with no modal in between → fire the guarded `Lead` on that click itself, since the click *is* the conversion (there's no later submit).

   Never fire `Lead` on the action of just opening a WhatsApp modal — that's still only intent to open, not a submission. Use the same project `content_name` across all of them.

5. After wiring every form, list them back to the user: file + line + what triggers it. Don't silently skip one — if a form's structure is unclear (e.g. it's controlled by a third-party form embed/iframe you can't hook into), say so explicitly instead of leaving it untracked without mention.

## Step 4 — Other standard events worth adding on landing pages

Beyond PageView + Lead, don't add these by default — offer them and let the user pick based on what the page actually has:

- **Contact** — a click-to-call, click-to-WhatsApp, or click-to-email action that does NOT go through a data-collecting form (e.g. a floating WhatsApp button that jumps straight to `wa.me` with no modal in between, a phone number link). If a WhatsApp button opens a form first, that form's submit is the Lead; the button itself is not also a Contact.
- **Schedule** — clicking a "book a call" / Calendly / scheduling widget link.
- **ViewContent** — scrolling into a key section (pricing, services, case studies) via an `IntersectionObserver`. Useful for building retargeting audiences of engaged visitors on a single-page landing site where there's no natural "product page" to fire it on.
- **CompleteRegistration** — a newsletter or lead-magnet signup that is meaningfully different from the main quote/contact form and the user wants reported separately.

Do not add all of these reflexively. Meta's Aggregated Event Measurement only prioritizes up to 8 events per domain for iOS-affected optimization, and a cluttered event list makes Ads Manager reporting noisy. For most single-landing-page sites, **PageView + Lead** covers what's needed to run and optimize a lead-gen campaign; add `Contact` next if there's a direct-contact button with no form, and only reach for `Schedule`/`ViewContent`/`CompleteRegistration` if the page actually has that specific feature.

## Step 5 — Verify

On production, check it yourself with a headless browser (intercept the landing's backend so no real lead is created; see the `orwel` skill, "Automated check without side effects"). The pixel detects automated browsers and never sends `facebook.com/tr` requests there, so do not wait for network hits. Instead, from an init script, wrap `window.fbq` to record each call and read `fbq.getState().pixels` for the loaded IDs; expose a binding so the record survives a redirect to a thank-you page. Expect: the pixel ID is this client's, an invalid submit records no `Lead`, a valid submit records exactly one.

Then tell the user to confirm events are firing before trusting them in Ads Manager:

1. Install the **Meta Pixel Helper** Chrome extension — it shows which events fire on the current page in real time.
2. Meta Events Manager → the pixel → **Test Events** tab — walk through each form/button on the live or staging site and confirm `PageView`, `Lead`, and any other configured events show up with the right parameters.
3. If the site runs campaigns optimizing for iOS placements, remind the user to prioritize `Lead` (and `Contact` if used) under **Aggregated Event Measurement** for that domain in Events Manager.

### If phantom events fire on clicks that aren't conversions

Symptom: a `Lead` (or other event) is recorded on actions that shouldn't count — closing a modal, backdrop clicks, generic button clicks — "on any interaction." Two causes, both outside the app code:

1. **Automatic configuration** — the Pixel's built-in button-click detection. Fixed by the `fbq('set', 'autoConfig', false, ...)` line in the base snippet (Step 2). If phantom events appear on a pixel that doesn't have that line, add it.
2. **Codeless events from the Event Setup Tool** — if someone used Events Manager's "Event Setup Tool" to map a button click to a standard event via the UI, that mapping lives server-side in the pixel config and `autoConfig: false` does NOT remove it. The user must open Events Manager → the pixel → **Settings / Open Event Setup Tool** and delete the codeless event mapping manually.

Don't diagnose this from the code alone — if every code path is clean (the `Lead` calls only sit inside real submit handlers) but events still fire on close, the cause is one of these two Meta-side behaviors, not the code.

## Note on GTM

If the project already loads Google Tag Manager, ask whether the user wants the Pixel installed as a raw snippet (as above) or as a GTM tag with the Lead/PageView events fired via GTM triggers instead. Don't silently pick one — a raw snippet and a GTM-managed pixel both firing for the same Pixel ID double-counts every event.
