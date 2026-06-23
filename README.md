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
| `svelte-loading/` | Patrón | Carga de datos sin flicker en SvelteKit 2 + Svelte 5: `load` con promesas sin await (streaming), `{#await}` + skeletons, `depends`/`invalidate`, preload `hover`/`tap`, caché in-process con dedupe. Gotcha fatal: `each_key_duplicate` en Svelte 5. Repo **Orwel** = implementación de referencia. |
| `hyper-whatsapp/` | Producto | Stack WhatsApp **hyper-wa** (recibir→guardar→responder): 3 capas (engine hyper-wa + proxy hyperflow-core + bandeja hyperflow-app), Twilio sandbox, validación de firma del webhook, tablas `wa_*`, ventana 24h. Gotchas fatales: firma vs `PUBLIC_BASE_URL` exacto (403 silencioso), `wa_numbers` sin sembrar = inbound dropeado, Auth Token desincronizado ("envío sí, recibo no"), API Key Restricted necesita `Messages:Create`, un número sandbox → un solo workspace. |

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
