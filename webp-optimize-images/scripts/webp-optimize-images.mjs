#!/usr/bin/env node
// Optimize all raster images (JPG/JPEG/PNG) in a directory tree to WebP.
// Visually lossless by default, big weight savings, non-destructive unless told otherwise.
//
// Usage:
//   node optimize-images.mjs [--dir .] [--dry-run] [--quality 80] [--lossless]
//        [--near-lossless] [--effort 6] [--max-width N] [--max-height N]
//        [--force] [--replace] [--update-refs] [--concurrency N]
//
// Requires the `sharp` package (run via `npx --package=sharp node ...` if not installed).

import { readdir, stat, readFile, writeFile, unlink } from "node:fs/promises";
import { join, extname, relative, basename } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import os from "node:os";

// Resolve `sharp` robustly: it may live next to the script, in the project's
// node_modules (cwd), or in an npx-managed temp dir (NODE_PATH / npm global).
async function loadSharp() {
  // 1) Standard resolution (script dir / project node_modules).
  try {
    return (await import("sharp")).default;
  } catch {}
  // 2) Resolve from the current working directory and any NODE_PATH entries
  //    (this is where `npx --package=sharp` makes it available).
  const bases = [process.cwd(), ...(process.env.NODE_PATH || "").split(/[:;]/).filter(Boolean)];
  for (const base of bases) {
    try {
      const req = createRequire(join(base, "noop.js"));
      const resolved = req.resolve("sharp");
      return (await import(pathToFileURL(resolved).href)).default;
    } catch {}
  }
  return null;
}

const sharp = await loadSharp();
if (!sharp) {
  console.error(
    "ERROR: `sharp` is not available. Run this script with:\n" +
      '  npx --yes --package=sharp node "<this-script>" ...\n' +
      "or `npm install sharp` in the project first."
  );
  process.exit(1);
}

// ---- args ----------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
const flag = (name) => argv.includes(`--${name}`);

const CONFIG = {
  dir: String(opt("dir", ".")),
  dryRun: flag("dry-run"),
  quality: Number(opt("quality", 80)),
  lossless: flag("lossless"),
  nearLossless: flag("near-lossless"),
  effort: Number(opt("effort", 6)),
  maxWidth: opt("max-width", null) ? Number(opt("max-width")) : null,
  maxHeight: opt("max-height", null) ? Number(opt("max-height")) : null,
  force: flag("force"),
  replace: flag("replace"),
  updateRefs: flag("update-refs"),
  concurrency: Number(opt("concurrency", os.cpus().length || 4)),
};

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png"]);
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next",
  ".svelte-kit", ".nuxt", "coverage", ".cache", ".vercel", "out",
]);
const SOURCE_EXT = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".svelte", ".vue", ".astro",
  ".html", ".htm", ".css", ".scss", ".sass", ".less", ".md", ".mdx", ".json",
]);

// ---- helpers -------------------------------------------------------------
const fmtBytes = (n) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
};

async function walk(root, onFile) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      await walk(p, onFile);
    } else if (e.isFile()) {
      await onFile(p);
    }
  }
}

// Decide near-lossless for graphics-y images (alpha channel or PNG), lossy otherwise.
async function encodeOptions(inputPath, meta) {
  const isPng = extname(inputPath).toLowerCase() === ".png";
  const hasAlpha = !!meta.hasAlpha;
  const wantNearLossless = CONFIG.nearLossless || (isPng && hasAlpha && !CONFIG.lossless);

  if (CONFIG.lossless) {
    return { lossless: true, effort: CONFIG.effort, quality: 100 };
  }
  if (wantNearLossless) {
    return { nearLossless: true, quality: 90, effort: CONFIG.effort };
  }
  return { quality: CONFIG.quality, effort: CONFIG.effort };
}

async function convertOne(inputPath) {
  const outPath = inputPath.replace(/\.(jpe?g|png)$/i, ".webp");
  const origSize = (await stat(inputPath)).size;

  let pipeline = sharp(inputPath, { failOn: "none" });
  const meta = await pipeline.metadata();

  if (CONFIG.maxWidth || CONFIG.maxHeight) {
    pipeline = pipeline.resize({
      width: CONFIG.maxWidth || undefined,
      height: CONFIG.maxHeight || undefined,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  const webpOpts = await encodeOptions(inputPath, meta);
  const buf = await pipeline.webp(webpOpts).toBuffer();
  const newSize = buf.length;
  const smaller = newSize < origSize;

  const result = {
    input: inputPath,
    output: outPath,
    origSize,
    newSize,
    smaller,
    written: false,
    replaced: false,
    skipped: false,
  };

  if (!smaller && !CONFIG.force) {
    result.skipped = true;
    return result;
  }

  if (!CONFIG.dryRun) {
    await writeFile(outPath, buf);
    result.written = true;
    if (CONFIG.replace && smaller && outPath.toLowerCase() !== inputPath.toLowerCase()) {
      await unlink(inputPath);
      result.replaced = true;
    }
  }
  return result;
}

// Simple concurrency-limited map.
async function mapLimit(items, limit, fn) {
  const out = [];
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try {
        out[i] = await fn(items[i]);
      } catch (err) {
        out[i] = { input: items[i], error: String(err?.message || err) };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

async function updateReferences(root, converted) {
  // Map basename.ext -> basename.webp for every successfully converted image.
  const renameByBase = new Map();
  for (const r of converted) {
    if (r.error || r.skipped) continue;
    const from = basename(r.input);
    const to = basename(r.output);
    if (from !== to) renameByBase.set(from, to);
  }
  if (renameByBase.size === 0) return 0;

  let filesChanged = 0;
  await walk(root, async (p) => {
    if (!SOURCE_EXT.has(extname(p).toLowerCase())) return;
    let text;
    try {
      text = await readFile(p, "utf8");
    } catch {
      return;
    }
    let changed = false;
    for (const [from, to] of renameByBase) {
      // Replace the filename only when it appears as a path segment (preceded by / \ " ' ` ( or start).
      const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`([\\/\\\\"'\`(=\\s])${esc}`, "g");
      if (re.test(text)) {
        text = text.replace(re, `$1${to}`);
        changed = true;
      }
    }
    if (changed && !CONFIG.dryRun) {
      await writeFile(p, text, "utf8");
    }
    if (changed) filesChanged++;
  });
  return filesChanged;
}

// ---- main ----------------------------------------------------------------
const images = [];
await walk(CONFIG.dir, async (p) => {
  if (IMAGE_EXT.has(extname(p).toLowerCase())) images.push(p);
});

if (images.length === 0) {
  console.log(`No JPG/JPEG/PNG images found under "${CONFIG.dir}".`);
  process.exit(0);
}

console.log(
  `${CONFIG.dryRun ? "[DRY RUN] " : ""}Optimizing ${images.length} image(s) in "${CONFIG.dir}" ` +
    `(quality=${CONFIG.quality}, effort=${CONFIG.effort}` +
    `${CONFIG.lossless ? ", lossless" : ""}${CONFIG.nearLossless ? ", near-lossless" : ""}` +
    `${CONFIG.replace ? ", replace" : ""})\n`
);

const results = await mapLimit(images, CONFIG.concurrency, convertOne);

let totalOrig = 0, totalNew = 0, converted = 0, skipped = 0, errors = 0;
const rows = [];
for (const r of results) {
  if (r.error) {
    errors++;
    rows.push(["ERR ", r.input, r.error]);
    continue;
  }
  if (r.skipped) {
    skipped++;
    rows.push(["skip", relative(CONFIG.dir, r.input), "webp not smaller"]);
    continue;
  }
  converted++;
  totalOrig += r.origSize;
  totalNew += r.newSize;
  const delta = (1 - r.newSize / r.origSize) * 100;
  const label = delta >= 0 ? `-${delta.toFixed(1)}%` : `+${(-delta).toFixed(1)}% larger`;
  rows.push([
    r.replaced ? "repl" : "conv",
    relative(CONFIG.dir, r.input),
    `${fmtBytes(r.origSize)} → ${fmtBytes(r.newSize)}  (${label})`,
  ]);
}

const pad = Math.min(60, Math.max(...rows.map((r) => r[1].length), 4));
for (const [tag, file, info] of rows) {
  console.log(`  ${tag}  ${file.padEnd(pad)}  ${info}`);
}

console.log("");
if (converted > 0) {
  const totalPct = ((1 - totalNew / totalOrig) * 100).toFixed(1);
  console.log(
    `${CONFIG.dryRun ? "[DRY RUN] " : ""}Converted ${converted} image(s): ` +
      `${fmtBytes(totalOrig)} → ${fmtBytes(totalNew)}  ` +
      `(saved ${fmtBytes(totalOrig - totalNew)}, ${totalPct >= 0 ? "-" : "+"}${Math.abs(totalPct)}%)`
  );
}
if (skipped) console.log(`Skipped ${skipped} (WebP not smaller; use --force to write anyway).`);
if (errors) console.log(`Errors: ${errors}.`);

if (CONFIG.updateRefs) {
  const changed = await updateReferences(CONFIG.dir, results);
  console.log(
    `${CONFIG.dryRun ? "[DRY RUN] " : ""}Reference update: ${changed} source file(s) ` +
      `${CONFIG.dryRun ? "would be" : "were"} modified. Review with \`git diff\`.`
  );
}
