#!/usr/bin/env node
/**
 * measure.mjs — Unified Lighthouse baseline for the web-perf-seo skill.
 *
 * Two sources, one report shape (both return the same `lighthouseResult` object):
 *   - lighthouse : runs Lighthouse locally via `npx lighthouse` against any URL
 *                  (localhost dev/build or a live URL). Needs Chrome installed.
 *   - psi        : calls Google PageSpeed Insights API against a PUBLIC url. Adds
 *                  real-world CrUX field data. Optional PSI_API_KEY env (higher quota).
 *
 * Usage:
 *   node measure.mjs --url http://localhost:4173 --mode lighthouse
 *   node measure.mjs --url https://example.com --mode psi --strategy mobile
 *   node measure.mjs --url https://example.com --mode both
 *   ... add --json <path> to also dump the full parsed summary as JSON.
 *
 * Zero deps for PSI (global fetch). Lighthouse is fetched on demand via npx.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const url = arg("url");
const mode = arg("mode", "lighthouse"); // lighthouse | psi | both
const strategy = arg("strategy", "mobile"); // mobile | desktop
const jsonOut = arg("json");

if (!url) {
  console.error(`ERROR: --url is required.
  node measure.mjs --url <url> [--mode lighthouse|psi|both] [--strategy mobile|desktop] [--json out.json]`);
  process.exit(1);
}

const CATEGORY_ORDER = ["performance", "accessibility", "best-practices", "seo"];
const LAB_METRICS = [
  ["first-contentful-paint", "FCP"],
  ["largest-contentful-paint", "LCP"],
  ["total-blocking-time", "TBT"],
  ["cumulative-layout-shift", "CLS"],
  ["speed-index", "Speed Index"],
  ["interactive", "TTI"],
];

// ---- turn a Lighthouse Result (lhr) into a compact, prioritized summary ----
function summarize(lhr, label) {
  const cats = {};
  for (const key of CATEGORY_ORDER) {
    const c = lhr.categories?.[key];
    if (c && c.score != null) cats[key] = Math.round(c.score * 100);
  }

  const metrics = LAB_METRICS.map(([id, name]) => {
    const a = lhr.audits?.[id];
    return a ? { name, value: a.displayValue || String(a.numericValue ?? ""), score: a.score } : null;
  }).filter(Boolean);

  // Opportunities & diagnostics with quantified savings, sorted by impact.
  const opps = [];
  for (const [id, a] of Object.entries(lhr.audits || {})) {
    if (a.score === 1 || a.score == null) continue; // passing or informational
    const ms = a.details?.overallSavingsMs ?? a.metricSavings?.LCP ?? 0;
    const bytes = a.details?.overallSavingsBytes ?? 0;
    if (a.scoreDisplayMode === "informative" && !ms && !bytes) continue;
    opps.push({
      id,
      title: a.title,
      savingsMs: Math.round(ms),
      savingsKb: Math.round(bytes / 1024),
      score: a.score,
    });
  }
  opps.sort((x, y) => y.savingsMs - x.savingsMs || y.savingsKb - x.savingsKb);

  // Failed non-performance checks (a11y / seo / best-practices), grouped by category.
  const failuresByCat = {};
  for (const key of ["accessibility", "best-practices", "seo"]) {
    const refs = lhr.categories?.[key]?.auditRefs || [];
    const failed = [];
    for (const ref of refs) {
      const a = lhr.audits?.[ref.id];
      if (a && a.score != null && a.score < 1 && a.scoreDisplayMode !== "informative") {
        failed.push({ id: ref.id, title: a.title });
      }
    }
    if (failed.length) failuresByCat[key] = failed;
  }

  return { label, url: lhr.finalDisplayedUrl || lhr.finalUrl || url, cats, metrics, opps, failuresByCat };
}

function scoreBadge(n) {
  if (n == null) return "  - ";
  const tag = n >= 90 ? "✅" : n >= 50 ? "🟡" : "🔴";
  return `${tag} ${String(n).padStart(3)}`;
}

function printSummary(s) {
  console.log(`\n══════════ ${s.label} ══════════`);
  console.log(`URL: ${s.url}`);
  console.log(`\nScores:`);
  for (const key of CATEGORY_ORDER) {
    if (s.cats[key] != null) console.log(`  ${scoreBadge(s.cats[key])}  ${key}`);
  }
  const belowGate = CATEGORY_ORDER.filter((k) => s.cats[k] != null && s.cats[k] < 90);
  console.log(belowGate.length ? `\n⚠  Below 90/100: ${belowGate.join(", ")}` : `\n🎯 All measured categories ≥ 90.`);

  if (s.crux) {
    console.log(`\nField data (CrUX, real users):`);
    for (const [k, v] of Object.entries(s.crux)) console.log(`  ${k}: ${v}`);
  }

  console.log(`\nLab metrics:`);
  for (const m of s.metrics) console.log(`  ${m.score === 1 ? "✅" : m.score >= 0.5 ? "🟡" : "🔴"} ${m.name}: ${m.value}`);

  if (s.opps.length) {
    console.log(`\nTop performance opportunities (fix in this order):`);
    for (const o of s.opps.slice(0, 15)) {
      const save = [o.savingsMs ? `${o.savingsMs}ms` : "", o.savingsKb ? `${o.savingsKb}KB` : ""].filter(Boolean).join(", ");
      console.log(`  • [${o.id}] ${o.title}${save ? `  →  ~${save}` : ""}`);
    }
  }

  for (const [cat, fails] of Object.entries(s.failuresByCat)) {
    console.log(`\nFailed ${cat} checks:`);
    for (const f of fails) console.log(`  ✗ [${f.id}] ${f.title}`);
  }
  console.log(`\nMap each [audit-id] to a fix in references/fixes.md (perf/a11y/best-practices) or references/seo-and-meta.md (seo).`);
}

// ---- runners ----
function runLighthouse() {
  console.error(`Running Lighthouse locally against ${url} (this spawns headless Chrome)...`);
  const res = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "--yes",
      "lighthouse",
      url,
      "--quiet",
      "--chrome-flags=--headless=new --no-sandbox",
      "--output=json",
      "--output-path=stdout",
      "--only-categories=performance,accessibility,best-practices,seo",
      `--form-factor=${strategy === "desktop" ? "desktop" : "mobile"}`,
      strategy === "desktop" ? "--preset=desktop" : "",
    ].filter(Boolean),
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (res.status !== 0 && !res.stdout) {
    throw new Error(`lighthouse failed: ${res.stderr || res.error?.message || "unknown error"}`);
  }
  // stdout may include a trailing newline / stray logs; grab the JSON object.
  const start = res.stdout.indexOf("{");
  const lhr = JSON.parse(res.stdout.slice(start));
  return summarize(lhr, `Lighthouse (${strategy})`);
}

async function runPsi() {
  const api = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  api.searchParams.set("url", url);
  api.searchParams.set("strategy", strategy);
  for (const c of CATEGORY_ORDER) api.searchParams.append("category", c);
  if (process.env.PSI_API_KEY) api.searchParams.set("key", process.env.PSI_API_KEY);

  console.error(`Querying PageSpeed Insights (${strategy}) for ${url}...`);
  const res = await fetch(api);
  const body = await res.json();
  if (!res.ok) {
    let hint = "";
    if (res.status === 429) {
      hint = process.env.PSI_API_KEY
        ? "\n  → Your PSI_API_KEY hit its daily quota. Retry later or use --mode lighthouse."
        : "\n  → Anonymous PSI quota exhausted. Set PSI_API_KEY (Google Cloud console) or use --mode lighthouse for local runs.";
    }
    throw new Error(`PSI HTTP ${res.status}: ${JSON.stringify(body?.error || body).slice(0, 300)}${hint}`);
  }
  const s = summarize(body.lighthouseResult, `PageSpeed Insights (${strategy})`);
  // Attach CrUX field data when present.
  const le = body.loadingExperience?.metrics;
  if (le) {
    s.crux = {};
    const map = {
      LARGEST_CONTENTFUL_PAINT_MS: "LCP",
      CUMULATIVE_LAYOUT_SHIFT_SCORE: "CLS",
      INTERACTION_TO_NEXT_PAINT: "INP",
      FIRST_CONTENTFUL_PAINT_MS: "FCP",
    };
    for (const [k, name] of Object.entries(map)) {
      if (le[k]) s.crux[name] = `${le[k].percentile} (${le[k].category})`;
    }
  }
  return s;
}

// ---- dispatch ----
try {
  const summaries = [];
  if (mode === "lighthouse" || mode === "both") summaries.push(runLighthouse());
  if (mode === "psi" || mode === "both") summaries.push(await runPsi());

  for (const s of summaries) printSummary(s);

  if (jsonOut && jsonOut !== true) {
    fs.writeFileSync(jsonOut, JSON.stringify(summaries, null, 2));
    console.log(`\nFull summary JSON → ${jsonOut}`);
  }
} catch (err) {
  console.error(`\n[measure] ERROR: ${err.message}\n`);
  process.exitCode = 1; // let Node drain open sockets instead of aborting (avoids Windows libuv assertion)
}
