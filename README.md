# hyper-skills

Colección de **Skills de Claude Code** de Hyperlabs. Cada subcarpeta = un skill instalable que Claude carga bajo demanda según su `description`. Repo: `github.com/hyperlabs-ai/hyper-skills`.

## Qué representa

Conocimiento de producción de Hyperlabs empaquetado como skills reutilizables, para que Claude Code aplique los mismos patrones, reglas y gotchas en cualquier proyecto sin re-aprenderlos cada vez. Dos tipos de skill:

- **Skills de producto** — cómo integrar/usar productos propios (ej. el SDK Orwel).
- **Skills de patrón** — patrones técnicos portables destilados de apps reales (ej. carga de datos en SvelteKit), no atados a un repo.

## Qué debe hacer

- Servir de fuente única de verdad para reglas no-negociables (ej. API key en env, nunca hardcodeada).
- Transferir patrones probados en prod a proyectos nuevos sin copiar código a mano.
- Capturar gotchas fatales y anti-patrones que ya causaron bugs reales, para no repetirlos.
- Cada skill = un `SKILL.md` con frontmatter (`name`, `description`, `disable-model-invocation`) que dispara su carga por triggers concretos.

## Qué hace hoy

### Skills completos

| Skill | Tipo | Qué cubre |
|-------|------|-----------|
| `orwel/` | Producto | Instalar/inicializar/usar el SDK de analítica **Orwel** (`orwel` en npm). Wrapper por framework (SvelteKit, Next, Vite, Nuxt, Astro, Vue), API key en env, init único client-side, API: `track`/`identify`/`conversion`/`session`/`monitor`/`form`. Regla crítica: conversión de lead **debe** llevar email o no se manda la notificación. Troubleshooting `form_abandon`/`fields_filled`. |
| `ga4-setup/` | Producto | Configurar conversiones de **Google Analytics 4** en una landing de punta a punta: leer la landing, proponer `tracking-plan.json` (eventos recomendados GA4: `generate_lead`, `contact`…), instrumentar `gtag` con el measurement ID en env, registrar key events / dimensiones / reglas de creación de eventos vía el **MCP de ops-hyper** (`ga_setup_tracking`, dry run por default, idempotente) y verificar con `ga_realtime_events`. Las credenciales de Google viven solo en Ops. Reglas: `generate_lead` solo en éxito confirmado, nunca PII en parámetros, nunca un segundo tag. |
| `svelte-loading/` | Patrón | Carga de datos sin flicker en SvelteKit 2 + Svelte 5: `load` con promesas sin await (streaming), `{#await}` + skeletons, `depends`/`invalidate`, preload `hover`/`tap`, caché in-process con dedupe. Gotcha fatal: `each_key_duplicate` en Svelte 5. Repo **Orwel** = implementación de referencia. |
| `hyper-whatsapp/` | Producto | Stack WhatsApp **hyper-wa** (recibir→guardar→responder): 3 capas (engine hyper-wa + proxy hyperflow-core + bandeja hyperflow-app), Twilio sandbox, validación de firma del webhook, tablas `wa_*`, ventana 24h. Gotchas fatales: firma vs `PUBLIC_BASE_URL` exacto (403 silencioso), `wa_numbers` sin sembrar = inbound dropeado, Auth Token desincronizado ("envío sí, recibo no"), API Key Restricted necesita `Messages:Create`, un número sandbox → un solo workspace. |
| `webp-optimize-images/` | Patrón | Convertir/comprimir todas las imágenes raster (JPG/JPEG/PNG) de un workspace a **WebP** sin pérdida visible y con gran ahorro de peso. Script Node con `sharp` vía `npx` (sin instalar nada). Defaults: fotos lossy `q80 effort6`, gráficos/PNG con alpha near-lossless. No destructivo por defecto (dry-run primero); `--replace` borra originales y `--update-refs` reescribe referencias en el código. Anti-bloat: omite el WebP si saldría más grande que el original. Fallback a `cwebp`. |
| `web-perf-seo/` | Patrón | Optimizar un sitio hasta **Lighthouse ≥90/100** en las 4 categorías (Performance, Accessibility, Best Practices, SEO) con un loop medido: **baseline → priorizar → arreglar → re-medir**. Motor `scripts/measure.mjs` unificado (Lighthouse local + PageSpeed Insights, mismo formato de reporte, con datos de campo CrUX). Playbook `references/fixes.md` mapea cada audit-id → fix con notas Vite/Next/SvelteKit; `references/seo-and-meta.md` cubre SEO on-page, meta/OG, JSON-LD, sitemap/robots. Delega la conversión de imágenes a `webp-optimize-images`. Regla clave: medir nunca adivinar; build de producción para Performance; ítems de servidor/CDN (TTFB, compresión, cache) se marcan como acciones de deploy, no se disfrazan de fix de código. Incluye el slash command **`/nitro`** (`commands/nitro.md`), con modo `/nitro all <url-live>` que optimiza el proyecto local **y** lo compara contra el sitio en producción. |

### Skills propuestos (placeholder, sin contenido aún)

Solo título en el nombre de archivo `.txt`, pendientes de redactar:

- `hyper-env/` — entornos de prueba para testear AI.
- `hyper-llm/` — arquitectura para implementar RAG y agentes de AI.
- `hyper-core/` — arquitectura para nuevos backends.
- `hyper-sdk/` — arquitectura para crear nuevos SDK.
- `hyper-doc/` — genera documentación completa del proyecto donde se ejecuta.
- `hyper-papers/` — genera un paper de algún proyecto implementado.

## Estructura

```
hyper-skills/
├── orwel/SKILL.md            # completo
├── svelte-loading/SKILL.md   # completo
├── hyper-whatsapp/SKILL.md   # completo
├── webp-optimize-images/     # completo (SKILL.md + scripts/)
├── web-perf-seo/             # completo (SKILL.md + scripts/ + references/ + commands/nitro.md)
├── hyper-env/   *.txt         # propuesto
├── hyper-llm/   *.txt         # propuesto
├── hyper-core/  *.txt         # propuesto
├── hyper-sdk/   *.txt         # propuesto
├── hyper-doc/   *.txt         # propuesto
└── hyper-papers/*.txt         # propuesto
```

## Cómo agregar un skill

1. Crear carpeta `nombre-skill/`.
2. Dentro, `SKILL.md` con frontmatter:
   ```yaml
   ---
   name: nombre-skill
   description: Qué hace + CUÁNDO usarlo (triggers concretos que disparan la carga).
   disable-model-invocation: false
   ---
   ```
3. Body: reglas (empezar por la no-negociable como "Rule 0"), patrones, gotchas, anti-patrones, checklist, docs upstream.

Convención: la `description` decide la relevancia — incluir triggers explícitos (nombres de API, archivos, síntomas) para que Claude active el skill en el momento correcto.
