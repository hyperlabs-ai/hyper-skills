# SEO fixes, meta tags & structured data

Covers the Lighthouse **SEO** category audits plus the on-page essentials Lighthouse doesn't
score but that matter for ranking. Fix the audit-ids first, then apply the checklist.

## Lighthouse SEO audit-ids → fix

- `document-title` — every page needs a unique, descriptive `<title>` (~50–60 chars).
- `meta-description` — unique `<meta name="description">` per page (~150–160 chars).
- `http-status-code` — page must return 200 (not 4xx/5xx to crawlers).
- `is-crawlable` — no accidental `<meta name="robots" content="noindex">` or robots.txt block
  on pages that should rank.
- `robots-txt` — valid, reachable `/robots.txt`.
- `crawlable-anchors` — links must be real `<a href="...">`, not `<div onclick>` / `<span>`.
- `link-text` — descriptive anchor text, never "click here" / "read more" alone.
- `canonical` — valid `<link rel="canonical" href="https://…absolute-url">` (no relative, no
  pointing to a different page).
- `hreflang` — valid `hreflang` for multi-language pages.
- `image-alt` — every `<img>` has `alt` (shared with accessibility).
- `viewport` — `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- `font-size` / `tap-targets` — legible mobile text (≥12px) and adequately sized touch targets.
- `structured-data` — present and valid (Lighthouse only flags presence; validate separately,
  see below).

## Head template (per page — fill from the page's real content)

```html
<title>Primary keyword + brand — concise value prop</title>
<meta name="description" content="One clear sentence with the primary keyword and a reason to click, ~155 chars." />
<link rel="canonical" href="https://example.com/this-page" />
<meta name="viewport" content="width=device-width, initial-scale=1" />

<!-- Open Graph (social/link previews — not a Lighthouse item but expected) -->
<meta property="og:type" content="website" />
<meta property="og:title" content="…" />
<meta property="og:description" content="…" />
<meta property="og:image" content="https://example.com/og-image.jpg" /> <!-- 1200×630 -->
<meta property="og:url" content="https://example.com/this-page" />

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image" />
```

### Where to put it per framework
- **Next.js (App Router):** export a `metadata` object or `generateMetadata()` per route —
  don't hand-write `<head>`. Handles title/description/canonical/OG/Twitter.
- **Next.js (Pages Router):** `next/head`.
- **SvelteKit:** `<svelte:head>` in the page component, driven by `load` data.
- **Vite/React SPA:** `react-helmet-async`, or (better for SEO) prerender/SSG so meta is in the
  initial HTML — a client-only SPA that injects meta after JS hurts crawlability.

> SPA caveat: if the site is client-rendered, crawlers may see an empty shell. Prefer SSR/SSG/
> prerendering (Next.js, SvelteKit adapters, or a prerender plugin) so titles, descriptions, and
> content exist in the served HTML.

## Structured data (JSON-LD)

Add relevant schema.org JSON-LD in `<head>` or end of `<body>`. Pick the type matching the page:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Company",
  "url": "https://example.com",
  "logo": "https://example.com/logo.png",
  "sameAs": ["https://www.linkedin.com/company/…"]
}
</script>
```
Common types for landing pages: `Organization`, `LocalBusiness`, `Product`, `Service`,
`BreadcrumbList`, `FAQPage`, `WebSite` (with `SearchAction`). Validate at
<https://validator.schema.org/> and Google's Rich Results Test — invalid JSON-LD is worse than
none.

## Site-level essentials (beyond Lighthouse's single-page score)

- **`/sitemap.xml`** — generate and reference it in `robots.txt` (`Sitemap: https://…/sitemap.xml`).
  Next.js: `app/sitemap.ts`. SvelteKit: a `sitemap.xml/+server.ts` endpoint.
- **`/robots.txt`** — allow crawling of public pages, disallow admin/preview paths.
- **One `<h1>` per page**, semantic heading hierarchy, and real landmark elements
  (`<header> <nav> <main> <footer>`).
- **HTTPS everywhere**, no mixed content.
- **Descriptive, stable URLs** (kebab-case, keyword-bearing, no volatile query strings for
  primary content).
- **Internal linking** with descriptive anchors between related pages.

## After SEO changes
Re-run `measure.mjs` — SEO is a fast category to get to 100. Then validate structured data and,
for a live site, check Google Search Console for coverage/indexing issues (outside this skill's
automated scope — flag it to the user).
