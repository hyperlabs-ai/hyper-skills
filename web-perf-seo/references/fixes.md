# Fix playbook — by Lighthouse audit-id

Each entry: what the audit means → the fix → framework notes (Vite / Next.js / SvelteKit).
Apply top-down by the savings the report reported. Re-measure after each batch.

---

## Images

### `modern-image-formats` / `uses-webp` — "Serve images in next-gen formats"
Convert JPEG/PNG to WebP (or AVIF). **Delegate bulk conversion to the `webp-optimize-images`
skill.** Then reference the `.webp` in markup.
- Next.js: use `next/image` (`import Image from "next/image"`) — it serves AVIF/WebP
  automatically. Configure `images.formats = ['image/avif','image/webp']` in `next.config.js`.
- Vite/SvelteKit: import through the bundler or use `@sveltejs/enhanced-img` /
  `vite-imagetools` to emit AVIF/WebP + `srcset` at build time.

### `uses-responsive-images` — "Properly size images"
Serve widths matched to the rendered size via `srcset`/`sizes`.
- Plain markup: `srcset="img-480.webp 480w, img-960.webp 960w" sizes="(min-width:768px) 50vw, 100vw"`.
- Next.js: `next/image` with `sizes` prop does this automatically.
- SvelteKit: `enhanced-img` generates the `srcset` set.

### `offscreen-images` — "Defer offscreen images" (lazy loading)
Add `loading="lazy"` to below-the-fold `<img>`. **Never** lazy-load the LCP/hero image.

### `unsized-images` / `image-aspect-ratio` — CLS from images
Set explicit `width` and `height` (intrinsic pixels) on every `<img>`; CSS then scales it.
This reserves space and kills layout shift. `next/image` requires width/height (or `fill`).

### `prioritize-lcp-image` / `largest-contentful-paint-element`
Preload and prioritize the hero image; do not lazy-load it.
- Markup: `<link rel="preload" as="image" href="/hero-1200.webp" imagesrcset="..." fetchpriority="high">` + `<img ... fetchpriority="high" loading="eager">`.
- Next.js: `next/image` with `priority` prop.

---

## JavaScript & CSS delivery

### `render-blocking-resources` — "Eliminate render-blocking resources"
Defer non-critical CSS/JS.
- Scripts: add `defer` (or `async` for independent scripts); move to end of `<body>`.
- Third-party tags (analytics, chat): load with `defer`, or in Next.js use `next/script` with
  `strategy="lazyOnload"` / `afterInteractive`.
- Critical CSS: inline the above-the-fold CSS, load the rest async. Tailwind already ships only
  used classes if `content` globs are correct — verify no giant unused CSS is shipped.

### `unused-css-rules` — "Reduce unused CSS"
- Tailwind: ensure `content`/`purge` covers all template paths so unused utilities are stripped.
  A bloated CSS bundle usually means a missing/incorrect `content` glob.
- Remove dead component libraries' global CSS; import only what's used.

### `unused-javascript` — "Reduce unused JavaScript"
Code-split and lazy-load.
- Next.js: `next/dynamic(() => import('./Heavy'), { ssr: false })` for below-the-fold/client-only.
- React (Vite): `React.lazy` + `<Suspense>`; route-level splitting.
- SvelteKit: split routes are automatic; use dynamic `import()` for heavy widgets.
- Audit heavy deps (moment, lodash, big date/chart libs) → swap for lighter or tree-shakeable
  imports (`import debounce from 'lodash/debounce'`, `date-fns`, etc.).

### `unminified-css` / `unminified-javascript`
Should never fail on a **production build**. If it does, you measured the dev server — rebuild
and measure `preview`/`start`. Confirm minification is on (default in Vite/Next/SvelteKit prod).

### `legacy-javascript` — "Avoid serving legacy JS to modern browsers"
Tighten the build target so no needless transpilation/polyfills ship.
- Vite: `build.target: 'es2020'` (or higher) in `vite.config`.
- Next.js: modern by default; check `browserslist` isn't set to ancient targets.

### `duplicated-javascript` / `total-byte-weight`
Deduplicate deps (single React copy), analyze the bundle (`vite-bundle-visualizer`,
`@next/bundle-analyzer`), and remove or lazy-load the heaviest chunks.

---

## Main-thread & runtime

### `mainthread-work-breakdown` / `bootup-time` — too much JS execution
Reduce/split JS (see `unused-javascript`), move heavy work off the main thread (web worker),
memoize expensive React renders, and avoid hydrating static content (RSC/`ssr` where possible).

### `dom-size` — "Avoid an excessive DOM size"
Virtualize long lists (`@tanstack/virtual`), paginate, and flatten deeply nested markup.

### `third-party-summary` — third-party scripts dominating
Defer/lazy-load them, self-host critical ones, remove unused tags, and use a facade for embeds
(e.g. click-to-load YouTube/maps).

### `non-composited-animations` — CLS/jank from animations
Animate only `transform`/`opacity` (GPU-composited); avoid animating layout properties
(width/height/top/left).

---

## Fonts

### `font-display` — invisible text during font load
Add `font-display: swap` (or `optional`) to `@font-face`.
- Next.js: `next/font` handles this and self-hosts automatically — prefer it over `<link>` to
  Google Fonts. Self-hosting also removes a render-blocking third-party request.
- Vite/SvelteKit: self-host the woff2, `@font-face { font-display: swap; }`, and
  `<link rel="preload" as="font" type="font/woff2" crossorigin>` the primary weight.

---

## Network / server (may need hosting/CDN config, not code)

### `server-response-time` — slow TTFB
Server/hosting concern. Enable SSG/ISR/edge caching, faster hosting, or a CDN. In Next.js prefer
static generation (`generateStaticParams`, ISR) over per-request SSR where possible. **Flag to
the user if it's a hosting limit.**

### `uses-text-compression` — enable gzip/brotli
Hosting/CDN setting (Netlify/Vercel/Cloudflare do this automatically; a custom server needs
compression middleware). Not fixable by a component edit — tell the user the exact setting.

### `uses-long-cache-ttl` — inefficient cache policy
Set `Cache-Control: public, max-age=31536000, immutable` for fingerprinted static assets. Vite/
Next/SvelteKit emit hashed filenames, so this is a host header config (`_headers`, `next.config`
headers(), or CDN rules).

### `uses-rel-preconnect` / `uses-rel-preload`
`<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` for required third-party
origins; `preload` truly critical assets (LCP image, primary font). Don't over-preload — it can
hurt.

### `redirects` — avoid multiple redirects
Link directly to the final URL; fix `http→https→www` chains at the host level.

---

## Best Practices (bugfixes that cost points)

### `errors-in-console` — "No browser errors logged to the console"
Open the site, read the console, fix the root cause of each error (undefined refs, failed
fetches, hydration mismatches, missing assets). Do not silence with try/catch to pass.

### `csp-xss`, `no-vulnerable-libraries`, `deprecations`
Add a Content-Security-Policy header; `npm audit fix` / upgrade vulnerable deps; replace
deprecated APIs flagged in the report.

### `doctype`, `charset`, `geolocation-on-start`, `notification-on-start`
Ensure `<!doctype html>` and `<meta charset="utf-8">` are first in `<head>`; never request
permissions on load.

---

## Accessibility (also a ranking/UX signal)

- `color-contrast` — meet 4.5:1 (normal text) / 3:1 (large). Adjust Tailwind color choices.
- `image-alt` — every `<img>` needs meaningful `alt` (empty `alt=""` only for decorative).
- `label` / `button-name` / `link-name` — form controls need labels; buttons/links need
  discernible text (visible or `aria-label`).
- `heading-order` — no skipped levels; one `<h1>`.
- `html-has-lang` — `<html lang="es">` (or the page's language).
- `aria-*` — remove invalid/mismatched ARIA; prefer native elements over ARIA where possible.
- `tap-targets` — interactive targets ≥ 24×24 (mobile) with spacing.

---

## Quick framework build/preview reference

| Framework | Build | Serve prod locally | Port |
|---|---|---|---|
| Vite (React/Svelte) | `npm run build` | `npm run preview` | 4173 |
| SvelteKit | `npm run build` | `npm run preview` | 4173 |
| Next.js | `npm run build` | `npm start` | 3000 |

Always measure Performance against these, **not** `npm run dev`.
