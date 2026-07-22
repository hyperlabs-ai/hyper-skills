---
description: Optimize a site to Lighthouse ≥90 (perf + SEO) via nitro. Use "all <url>" to optimize the local project AND benchmark it against a live site.
argument-hint: [url | local build url] OR "all <live-url>" to optimize local + compare vs live
---

Invoke the **nitro** skill (use the Skill tool with `nitro`). Parse `$ARGUMENTS`
and pick the mode:

## Mode A — default (arg is empty or a single URL/path)
Run the skill's normal measured loop — baseline → prioritize → fix → re-measure — until the
target scores **≥90/100 on all four Lighthouse categories** on mobile and desktop.
- If a **live URL** was given → baseline with PageSpeed Insights (`--mode psi`).
- If empty or a **local build URL** → work in the current project; build for production and
  measure the preview build with Lighthouse (`--mode lighthouse`), never the dev server.

## Mode B — "all <live-url>" (first token is the word `all`)
The remaining token is the **live/reference URL** (e.g. `all https://misitio.com`). Do the full
job in one pass: optimize the LOCAL project (the repo where this command runs) AND compare it
against that live site. Steps:

1. **Baseline the live site** — `measure.mjs --url <live-url> --mode psi --strategy mobile
   --json .nitro/live-baseline.json` (also run `--strategy desktop`). This is the "before / what's
   currently deployed" reference, including CrUX field data.
2. **Baseline the local project** — build for production and serve it (Vite/SvelteKit
   `build`+`preview` → :4173, Next.js `build`+`start` → :3000), then `measure.mjs --url
   http://localhost:<port> --mode lighthouse --json .nitro/local-baseline.json`.
3. **Optimize the local project** — run the skill's full fix loop (images, JS/CSS delivery, Core
   Web Vitals, console bugs, on-page SEO) until every category is **≥90** on mobile and desktop,
   re-measuring after each batch.
4. **Final comparison report** — a table with three columns per category (Performance, A11y, Best
   Practices, SEO) and the Core Web Vitals: **Live (current)** vs **Local before** vs **Local
   after**. Call out where the optimized local build now beats the live site, and flag anything
   still under 90 with the reason (e.g. server-side TTFB/compression the local build can't fix).
5. Note clearly that shipping these gains requires deploying the optimized local build; list the
   server/CDN-only items (compression, cache headers, TTFB) separately as deploy-time actions.

Put the saved JSON under a `.nitro/` folder (create it; suggest git-ignoring it).

Target / arguments: $ARGUMENTS

If the mode or target is ambiguous (e.g. `all` with no URL, or no clear local project), ask once
which live URL and which local port/build to use, then proceed.
