---
name: webp-optimize-images
description: Convert and compress all raster images in a workspace to WebP with big file-size savings and no visible quality loss. Use when the user wants to optimize, compress, shrink, or convert images (JPG/JPEG/PNG) to WebP, reduce asset weight, or improve site performance/Lighthouse image scores. Triggers on "optimizar imágenes", "convertir a webp", "comprimir imágenes", "reducir peso de imágenes", "optimize images", "convert to webp".
disable-model-invocation: false
---

# Optimize images to WebP

Convert every raster image (JPG/JPEG/PNG) in a workspace to WebP, cutting most of the file weight while staying visually lossless. Uses a bundled Node script backed by [`sharp`](https://sharp.pixelplumbing.com/) — no global installs, no external services, works on Windows/macOS/Linux.

## Rule 0 — never destroy originals without confirmation

The default is **non-destructive**: WebP files are written next to the originals and nothing is deleted. Only pass `--replace` (delete originals) or `--update-refs` (rewrite code references) after the user explicitly asks for it, or after you have shown them the dry-run report and they approve. Originals that are already smaller than their WebP output are left as-is by default (see `--force`).

## Workflow

1. **Locate images.** Confirm the target directory (default: current workspace root). The script auto-skips `node_modules`, `.git`, `dist`, `build`, `.next`, `.svelte-kit`, `coverage`, and any `*.webp`.
2. **Dry-run first.** Always run with `--dry-run` once and show the user the projected savings before writing anything.
3. **Convert.** Run for real. Report per-file and total savings.
4. **(Optional) Update references + clean up.** Only if requested: `--update-refs` rewrites `.jpg/.jpeg/.png` references in source files to `.webp`, and `--replace` deletes the originals.

## Step 1 — ensure `sharp` is available

The script needs `sharp`. Prefer running it with `npx` so nothing pollutes the project:

```bash
# One-off, no install (downloads sharp into npx cache):
npx --yes --package=sharp node "<SKILL_DIR>/scripts/webp-optimize-images.mjs" --dry-run
```

If the project already has `sharp` in `node_modules`, plain `node` works:

```bash
node "<SKILL_DIR>/scripts/webp-optimize-images.mjs" --dry-run
```

Replace `<SKILL_DIR>` with this skill's own directory (where this `SKILL.md` lives) — typically `~/.claude/skills/webp-optimize-images` once installed, or the repo path when running from a clone.

> If `npx` cannot resolve `sharp` (offline / restricted registry), fall back to Google's `cwebp` CLI — see [Fallback](#fallback-cwebp).

## Step 2 — dry run

```bash
npx --yes --package=sharp node "<SKILL_DIR>/scripts/webp-optimize-images.mjs" --dir "." --dry-run
```

Show the user the table: original size → webp size → % saved, plus the total. Do not proceed to a destructive step without approval.

## Step 3 — convert for real

```bash
npx --yes --package=sharp node "<SKILL_DIR>/scripts/webp-optimize-images.mjs" --dir "."
```

This writes `photo.webp` next to `photo.jpg` and leaves originals untouched.

## Step 4 — optional: update references and delete originals

Only after explicit user approval:

```bash
# Rewrite import/src references in source files, then delete the originals:
npx --yes --package=sharp node "<SKILL_DIR>/scripts/webp-optimize-images.mjs" --dir "." --update-refs --replace
```

`--update-refs` scans source files (`.js .jsx .ts .tsx .svelte .vue .astro .html .css .scss .md .json`) and replaces references to each converted image's filename with the `.webp` version. Review the diff afterward (`git diff`) — automated reference rewriting can miss dynamically built paths.

## Quality settings — how "no visible quality loss + max savings" is achieved

The script picks sensible per-image defaults; override with flags when needed.

| Image kind | Default | Why |
|---|---|---|
| Photos (JPEG, opaque PNG) | lossy WebP `quality 80`, `effort 6` | Visually indistinguishable from source for photographic content, typically 25–35% smaller than a good JPEG and far smaller than PNG. |
| Graphics / screenshots / PNG with sharp edges or transparency | `--near-lossless` (`nearLossless`, alpha preserved) | Keeps crisp edges and text razor-sharp with much smaller files than PNG. |

Flags:

- `--quality <1-100>` — lossy quality (default `80`). Raise to `85–90` if the user reports softness; lower to `~70` for aggressive savings.
- `--lossless` — mathematically lossless WebP (larger; use only when the user demands pixel-perfect).
- `--near-lossless` — near-lossless mode, great for UI graphics/logos/screenshots.
- `--effort <0-6>` — compression effort/CPU (default `6`, smallest output).
- `--max-width <px>` / `--max-height <px>` — optionally downscale oversized images (huge real-world win; only if the user is OK with resizing).
- `--dir <path>` — target directory (default `.`).
- `--dry-run` — report only, write nothing.
- `--force` — write WebP even when it would be larger than the original.
- `--replace` — delete the original after a successful, smaller conversion.
- `--update-refs` — rewrite source-file references to point at `.webp`.
- `--concurrency <n>` — parallel workers (default = CPU count).

## Fallback: cwebp

If `sharp` is unavailable, Google's `cwebp` (from `libwebp`) does the same job per file:

```bash
# Photo, visually lossless:
cwebp -q 80 -m 6 input.jpg -o input.webp
# Graphics / transparency, near-lossless:
cwebp -near_lossless 60 -q 90 input.png -o input.webp
```

Install `libwebp`: `winget install Google.libwebp` (Windows), `brew install webp` (macOS), `apt install webp` (Debian/Ubuntu). Loop over files with a shell `find`/`Get-ChildItem` and skip the excluded directories manually.

## Notes

- WebP is supported by all current browsers. If the user must support very old clients, keep the originals as `<picture>` fallbacks instead of `--replace`.
- Animated GIFs → animated WebP is supported by `sharp` but the script converts only still images by default; handle GIFs case-by-case.
- SVGs are vector and are skipped — they don't belong in WebP.
