---
name: web-perf-seo
description: Audit and optimize a website until Lighthouse scores are ≥90/100 across Performance, Accessibility, Best Practices, and SEO. Measures a baseline (Lighthouse local + PageSpeed Insights), prioritizes by impact, applies fixes (images, content/JS/CSS loading, Core Web Vitals, console bugs, on-page SEO), and re-measures in a loop. Use when the user wants to make a site fast, improve Lighthouse/PageSpeed scores, fix Core Web Vitals, or boost technical SEO. Triggers on "optimizar sitio", "mejorar el score", "que cargue rápido", "lighthouse 90", "pagespeed", "core web vitals", "SEO técnico", "optimize website", "improve performance".
disable-model-invocation: false
---

# Web performance + SEO optimizer (target ≥90/100)

Drive a site to **≥90/100 on all four Lighthouse categories** (Performance, Accessibility,
Best Practices, SEO) through a measured loop: **baseline → prioritize → fix → re-measure**,
repeating until the gate is met. Built for React/Svelte apps (Vite, Next.js, SvelteKit).

`<SKILL_DIR>` below = the directory this skill is installed in (e.g.
`~/.claude/skills/web-perf-seo`). A companion `/nitro` slash command lives in
`commands/nitro.md` — install it to `~/.claude/commands/nitro.md` to run this skill as
`/nitro` (or `/nitro all <live-url>` to optimize a local project and benchmark it vs a live site).

## Golden rule — measure, never guess

Do **not** apply optimizations blind. Every change must be justified by a specific failing
audit in the baseline, and validated by a re-measure. "It's probably slow because of X" is not
allowed — get the number first, fix the highest-impact failing audit, confirm the number moved.

## The loop

### 1. Baseline
Get a real report before touching anything. Both sources share one output format.

- **Local (fast iteration)** — run against a *production build*, not the dev server (dev is
  unminified and misleads Performance). Start the built site, then:
  ```bash
  node "<SKILL_DIR>/scripts/measure.mjs" --url http://localhost:4173 --mode lighthouse
  ```
  Typical build+preview commands: Vite `npm run build && npm run preview` (→ :4173);
  SvelteKit `npm run build && npm run preview` (→ :4173); Next.js `npm run build && npm start` (→ :3000).
- **Live URL (the "real" number)** — PageSpeed Insights adds CrUX field data:
  ```bash
  node "<SKILL_DIR>/scripts/measure.mjs" --url https://the-site.com --mode psi --strategy mobile
  ```
  Optional: set `PSI_API_KEY` for higher quota (get one in Google Cloud console).
- **Both at once:** `--mode both`. Default strategy is **mobile** (what Google ranks on and
  the harder target); also check `--strategy desktop` before declaring victory.

Save the JSON with `--json baseline.json` so you can diff against the final run.

### 2. Prioritize
The report lists **category scores**, **Core Web Vitals lab metrics** (LCP, CLS, TBT),
**CrUX field data** (from PSI), then **opportunities sorted by estimated savings** and
**failed a11y/SEO/best-practices checks**. Work top-down:
1. Whichever category is furthest below 90 usually has the biggest, easiest wins.
2. Within Performance, do the opportunities with the largest ms/KB savings first.
3. Batch related fixes (all image audits together, all render-blocking together).

Show the user a short prioritized plan before applying changes.

### 3. Fix
Map each failing `[audit-id]` from the report to its remedy:
- **Performance, Core Web Vitals, Best Practices, Accessibility** → [references/fixes.md](references/fixes.md)
  (organized by audit-id, with Vite / Next.js / SvelteKit specifics).
- **SEO + meta + structured data** → [references/seo-and-meta.md](references/seo-and-meta.md).
- **Images** specifically: delegate the conversion to the **`webp-optimize-images`** skill
  (bulk convert existing raster to WebP). If a `magnific-images` skill is available, use it to
  source a missing image. This skill handles the *markup* side
  (srcset/sizes/dimensions/lazy/preload).

Apply changes in small, reviewable batches. After each batch, re-measure so you can attribute
the score delta to the change (and catch regressions).

### 4. Re-measure & gate
Re-run the same command(s) from step 1. Compare against `baseline.json`.
- If all four categories are **≥90** on mobile *and* desktop → done. Report the before/after.
- If not, return to step 2 with the new report. Stop and ask the user only if a remaining fix
  is risky (behavior change, dependency upgrade, backend/CDN/header changes you can't make from
  the repo) or if a score is blocked by something outside the codebase (e.g. slow TTFB from
  hosting, third-party scripts the user requires).

## Bugfixes count toward the score
`errors-in-console` (Best Practices) and broken images/links directly cost points. While fixing
performance, resolve JS console errors, 404s, missing `alt`, and layout shifts you encounter —
they are both correctness bugs and score items. Don't suppress errors to pass the audit; fix the
cause.

## Guardrails
- **Never sacrifice correctness for a number.** Don't remove needed scripts, lazy-load the LCP
  image, or delete content to game a metric. A 90 that breaks the page is a failure.
- **Production build only** for Performance numbers. Report which build was measured.
- **One category can't fix another's regression silently** — always re-check all four.
- **Server-side items** (TTFB/`server-response-time`, text compression, cache-control headers,
  HTTP/2) may need hosting/CDN config, not code. Flag these clearly to the user with the exact
  setting to change; don't pretend a code edit fixed them.
- Report honestly: show the baseline vs final table, and name any category still under 90 with
  the reason.
