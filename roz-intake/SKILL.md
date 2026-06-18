---
name: roz-intake
description: Send support tickets / feature requests from ANY external app into roz, which auto-documents them with Claude, auto-assigns the best developer, and creates the issue in Linear — no human in the loop. Use when an app needs a "report a problem" / "request a feature" / contact form that should land as a tracked Linear issue, or when wiring a client project to roz's intake endpoint. Triggers on mentions of "roz intake", "ROZ_INGEST_TOKEN", "/v1/intake", "enviar ticket a roz", "auto-ingest", or building a feedback/support form that must reach Linear.
disable-model-invocation: false
---

# roz intake — tickets from external apps

roz exposes a single public endpoint that any app (client product, internal tool, landing page) can POST to. roz then **documents the request with Claude** (infers a clean title, type and priority), **auto-assigns the best available developer**, and **creates the issue in Linear** — fully automated, no human triage.

One endpoint serves **all** projects. The project is selected per-request with `projectKey`; the same `ROZ_INGEST_TOKEN` is shared across apps.

## Endpoint

```
POST https://roz-ops.vercel.app/v1/intake
Authorization: Bearer <ROZ_INGEST_TOKEN>
Content-Type: application/json
```

> The base URL is roz's deployment (`https://roz-ops.vercel.app`). Use your own roz URL if different.

### Request body

| Field | Type | Required | Notes |
|---|---|---|---|
| `projectKey` | string | **yes** | The roz project key the ticket belongs to (e.g. `ORWEL`, `PROPPIE`). Must match a project registered in roz. |
| `description` | string | **yes** | The raw request, in the user's words. **Minimum 8 characters.** Don't pre-format it — Claude rewrites it. |
| `app` | string | no | Origin app name (for provenance). If omitted, send it via the `X-Roz-App` header. Falls back to `"app de cliente"`. |
| `customer` | string | no | Who reported it (name or email). Stored as the requester. |
| `title` | string | no | Suggested title. roz will infer one if omitted. |
| `attachments` | string[] | no | URLs of supporting files/screenshots. |

### Response `201`

```json
{
  "ok": true,
  "identifier": "ORW-123",
  "url": "https://linear.app/.../ORW-123",
  "title": "Checkout crashes when applying a coupon",
  "kind": "bug",
  "priority": "high",
  "assignedTo": { "devId": "…", "name": "Manuel" },
  "missing": []
}
```

- `identifier` / `url` — the Linear issue created.
- `kind` ∈ `feature | bug | chore | refactor`; `priority` ∈ `urgent | high | medium | low` (inferred by Claude).
- `assignedTo` — the auto-picked developer (or `null` if none could be assigned).
- `missing` — fields roz judged would have helped but weren't provided (useful to prompt the user for more detail next time). Non-blocking.

### Errors

| Status | Body `error.code` | Cause |
|---|---|---|
| `401` | `UNAUTHORIZED` | Missing/invalid bearer token. |
| `400` | `VALIDATION_ERROR` | Body failed validation (e.g. `description` < 8 chars) or `projectKey` not registered in roz. |
| `500` | `INTERNAL` | Unexpected error (e.g. no active developers to assign). |

## Security — read this first

**`ROZ_INGEST_TOKEN` is a secret. NEVER call this endpoint from the browser / client bundle.** It would expose the token to anyone. Always call it from your **server** (API route, server action, edge function, backend job) and keep the token in a server-only env var.

- ✅ Browser form → your server endpoint → roz `/v1/intake`
- ❌ Browser → roz `/v1/intake` directly

## Minimal client (TypeScript, server-side)

```ts
// lib/roz.ts  — import only from server code
const ROZ_URL = process.env.ROZ_URL ?? 'https://roz-ops.vercel.app';
const ROZ_TOKEN = process.env.ROZ_INGEST_TOKEN!; // server-only secret

export interface RozTicket {
  projectKey: string;
  description: string;        // min 8 chars
  customer?: string;
  title?: string;
  attachments?: string[];
}

export async function sendRozTicket(t: RozTicket) {
  const res = await fetch(`${ROZ_URL}/v1/intake`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${ROZ_TOKEN}`,
      'content-type': 'application/json',
      'x-roz-app': 'my-app', // provenance; or pass `app` in the body
    },
    body: JSON.stringify(t),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? `roz intake ${res.status}`);
  return json as {
    ok: true; identifier: string; url: string; title: string;
    kind: string; priority: string;
    assignedTo: { devId: string; name: string } | null; missing: string[];
  };
}
```

## Framework examples (server-side)

### SvelteKit — form action

```ts
// src/routes/support/+page.server.ts
import { fail } from '@sveltejs/kit';
import { sendRozTicket } from '$lib/server/roz';

export const actions = {
  default: async ({ request }) => {
    const form = await request.formData();
    const description = String(form.get('message') ?? '').trim();
    if (description.length < 8) return fail(400, { error: 'Cuéntanos un poco más (mín. 8 caracteres).' });

    const ticket = await sendRozTicket({
      projectKey: 'ORWEL',
      description,
      customer: String(form.get('email') ?? '') || undefined,
    });
    return { ok: true, identifier: ticket.identifier };
  },
};
```

### Next.js — route handler

```ts
// app/api/support/route.ts
import { NextResponse } from 'next/server';
import { sendRozTicket } from '@/lib/roz';

export async function POST(req: Request) {
  const { description, email } = await req.json();
  if (!description || description.length < 8) {
    return NextResponse.json({ error: 'description too short' }, { status: 400 });
  }
  try {
    const ticket = await sendRozTicket({ projectKey: 'PROPPIE', description, customer: email });
    return NextResponse.json({ ok: true, identifier: ticket.identifier });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
```

### curl (for testing)

```bash
curl -X POST https://roz-ops.vercel.app/v1/intake \
  -H "Authorization: Bearer $ROZ_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Roz-App: my-app" \
  -d '{
    "projectKey": "ORWEL",
    "description": "El checkout truena al aplicar un cupón en móvil",
    "customer": "ana@cliente.com"
  }'
```

## How it works after you POST

1. **Document** — Claude turns the raw `description` into a clean title + spec, and infers `kind` and `priority`.
2. **Route** — roz ranks active developers for the project and auto-assigns the best one (preferring a dev linked to Linear so the issue is assigned to the real person).
3. **Create** — the issue is created in Linear with a note in the description marking it came from an external app (`app` / `customer` provenance), then mirrored back into roz and the assignee is notified.

You get the Linear `identifier` and `url` back synchronously in the `201` response.

## Rules & gotchas

- **`description` ≥ 8 chars**, or you get `400`. Send the user's raw words; do not pre-summarize — roz documents it.
- **`projectKey` must be registered in roz.** If it isn't, you get a `400`. Ask the roz maintainer to register the project (and its repos) first.
- **Provenance:** set `app` (body) or `X-Roz-App` (header) so tickets are traceable to their origin. Pass `customer` so the requester is recorded.
- **Idempotency:** the endpoint is **not** idempotent — each POST creates a new issue. Debounce double-submits on your form (disable the button while pending).
- **Token rotation:** if `ROZ_INGEST_TOKEN` is ever exposed, rotate it in roz's env and in every app that uses it. It's shared across all apps.
- **Don't block the user on failure:** if roz returns an error, surface a friendly message and optionally retry server-side; never leak the token or the raw error to the browser.
