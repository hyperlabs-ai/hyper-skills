---
name: hyper-whatsapp
description: Build, run, and debug the hyper-wa WhatsApp stack (inbound→store→reply, and V2 outbound-first templates) across the hyper-wa engine, its per-app HostAdapter, the hyperflow-core proxy / TeamUp Deno proxy, and the inbox UIs. Use when working on WhatsApp messaging in HyperFlow or TeamUp, the Twilio sandbox/subaccounts, webhook signature validation, the wa_conversations/wa_messages/wa_numbers tables, the linked_entity generic schema, message templates (Content API), a second hyper-wa instance, or symptoms like "inbound messages don't arrive", "envío sí, recibo no", a 403 on the inbound webhook, 401/70051 on send, or 409 window_closed. Triggers on "hyper-wa", "WhatsApp inbox/bandeja", "Twilio sandbox", "wa_numbers", "HOST_APP", "HostAdapter", "linked_entity", "Content API/plantilla/template", "X-Twilio-Signature", "validateRequest", "/webhooks/twilio/inbound", "/v1/whatsapp", "/v1/conversations/start", or pasting a Twilio AC/SK credential.
disable-model-invocation: false
---

# hyper-wa — WhatsApp stack

Receive → store → reply WhatsApp. Three layers, each one job. **One engine codebase, one instance per app** (HyperFlow + TeamUp), selected by `HOST_APP`. The engine is app-agnostic; what differs per app is the `HostAdapter` (entity matching), the Supabase it points at, and the proxy runtime (Node/Hono in HyperFlow, Deno Edge Function in TeamUp). Not a portable SDK — it's a service you call over HTTP.

```
WhatsApp phone ─► Twilio ─► hyper-wa (engine) ─► Supabase (wa_* tables)
                               ▲   │ send                  ▲
hyperflow-app (React) ─► hyperflow-core (proxy/auth) ──────┘ reads tables directly
```

| Layer | Repo | Job | Auth |
|-------|------|-----|------|
| Engine | `hyper-wa` | Twilio transport, webhook ingest + signature, persistence, 24h window | S2S `X-Internal-Key` only |
| Proxy | `hyperflow-core` | trust boundary: validates session+workspace, proxies send, serves inbox reads | JWT/API key + RBAC |
| UI | `hyperflow-app` | inbox: list/thread/composer, polling | browser session |

**The browser NEVER calls hyper-wa and NEVER holds `INTERNAL_KEY`. Core is the only caller of hyper-wa.**

### Canonical files — read these before changing behavior
- Signature validation + inbound flow: `hyper-wa/src/routes/webhooks.ts` (`verifySignature`, `resolveWorkspaceByNumber`).
- Twilio client (send + template + sig): `hyper-wa/src/providers/twilio.ts` (`send`, `sendTemplate`).
- Send + window rule + template start: `hyper-wa/src/routes/messages.ts` (`/v1/messages`, `/v1/conversations/start`, `isWindowOpen`), `hyper-wa/src/services/conversations.ts`.
- **HostAdapter (per-app entity matching), selected by `HOST_APP`:** `hyper-wa/src/host/` (`index.ts` factory, `hyperflow.ts` → contacts, `teamup.ts` → candidatos). Returns `{entityType, entityId}` → persisted as `linked_entity_type`/`linked_entity_id`.
- Number routing: `hyper-wa/src/services/numbers.ts`.
- **HyperFlow** proxy + inbox reads: `hyperflow-core/src/services/whatsapp.ts`, `hyperflow-core/src/routes/whatsapp.ts`. Inbox UI: `hyperflow-app/src/pages/app/whatsapp.tsx`.
- **TeamUp** proxy (Deno): `teamup/supabase/functions/whatsapp/index.ts`. Inbox UI: `teamup/src/pages/dashboard/MensajesPage.tsx`, service `teamup/src/lib/services/whatsapp.ts`. Migration: `teamup/supabase/migrations/20260626_001_wa_inbox.sql`.
- Feature flag (HyperFlow): `hyperflow-core/src/routes/workspaces.ts` (`workspaceHasWhatsApp`).
- Design docs (workspace root): `hyper-wa-arquitectura.html`, `hyper-wa-v1-implementacion.html`, `hyper-wa-setup-twilio.html`, `hyper-wa-roadmap.html`, `hyper-wa-v2-teamup.html`. Deploy: `hyper-wa-deploy-railway.html`.

## Rule 0 — secrets in env, NEVER hardcoded or committed (non-negotiable)

Four secrets, all from env, none in git or logs:

| Secret | Used for |
|--------|----------|
| `TWILIO_AUTH_TOKEN` | **validates inbound webhook signature** (and account-level control) |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` | REST send auth (revocable without rotating the auth token) |
| `SUPABASE_SERVICE_ROLE_KEY` | bypasses RLS — leak = whole DB exposed |
| `INTERNAL_KEY` | S2S; must be identical on hyper-wa and core's `HYPER_WA_INTERNAL_KEY` |

Verify `git check-ignore .env` before any commit. If a user pastes an `AC.../SK...` or a `service_role` JWT in chat: write it to `.env`, don't echo it, don't commit it. `.env.example` = placeholders only.

## Auth split (the #1 conceptual trap)

Outbound and inbound use **different** Twilio credentials. Do not unify them.

```ts
// hyper-wa/src/providers/twilio.ts
this.client = twilio(API_KEY_SID, API_KEY_SECRET, { accountSid }); // SEND (REST)
twilio.validateRequest(AUTH_TOKEN, sig, url, params);             // INBOUND signature
```

- **Send** needs a Restricted API key with `Messaging → Messages → Create` (`twilio/messaging/messages/create`). Missing it → `401 code 70051`. Conversations permissions are NOT used (Programmable Messaging, not the Conversations API).
- **Inbound signature** can ONLY be validated with the Auth Token. An API key cannot — the Auth Token is mandatory and irreplaceable here.

---

# Diagnostic playbook (start here when something breaks)

## "Inbound messages don't arrive" (the most common failure)

The webhook fails **silently** — Twilio gets a `200`/`403` and the user sees nothing. Check in this order:

**1. Is Twilio even calling, and with what status?** ngrok dev inspector or Railway logs:
```bash
curl -s http://localhost:4040/api/requests/http?limit=10 | \
  python3 -c "import sys,json;[print(r['request']['method'],r['request']['uri'],'->',r['response']['status_code']) for r in json.load(sys.stdin)['requests']]"
```
- `403` → signature failure → go to step 2.
- `200` but nothing saved → routing/seed → step 3.
- no request at all → Twilio webhook URL misconfigured, or the phone never did `join` (sandbox opt-in).

**2. `403` = signature mismatch.** `verifySignature` hashes `PUBLIC_BASE_URL + path` and compares to `X-Twilio-Signature`. Two causes:
   - **URL mismatch:** `PUBLIC_BASE_URL` must equal the URL Twilio called, character for character (scheme, host, path). ngrok restart → new subdomain → update `.env` + Twilio config. On Railway use `https://${{RAILWAY_PUBLIC_DOMAIN}}`.
   - **Auth Token out of sync** (symptom: "envío sí, recibo no" — send works, receive 403s). The `.env` `TWILIO_AUTH_TOKEN` ≠ the account's current token (rotated/edited in console). Send keeps working because it uses the API key. Confirm by recomputing locally:
   ```bash
   # from hyper-wa/, with the captured sig+body+url from ngrok:
   node -e "require('dotenv/config');const t=require('twilio');console.log(t.validateRequest(process.env.TWILIO_AUTH_TOKEN,SIG,URL,PARAMS))"
   ```
   `false` → wrong token → copy the current Auth Token from Twilio into `.env`, restart.

**3. `200` but no row in `wa_messages`.** Inbound routes by the `To` number against `wa_numbers` with `.maybeSingle()` (`resolveWorkspaceByNumber`). No matching row → returns `200` and drops the message (logs "número sin workspace mapeado"). Seed it:
```sql
insert into wa_numbers (workspace_id, channel_number)
values ('<workspace-uuid>', '+14155238886') on conflict do nothing;
```

## "Send fails" — map the error

| Response | Cause | Fix |
|----------|-------|-----|
| `401 code 70051` | API key lacks Messaging:Create | grant it (Restricted) or use a Standard key |
| `409 window_closed` | sending before any inbound (24h window closed) | contact must message first; window opens on inbound, not outbound |
| `422 no_number_for_workspace` | workspace has no `wa_numbers` row | seed it (step 3 above) |
| `502 whatsapp_upstream_error` (from core) | core can't reach hyper-wa | check `HYPER_WA_BASE_URL` + `HYPER_WA_INTERNAL_KEY` in core's env; is hyper-wa up? |
| `queued` forever, never `delivered` | status callback unreliable in sandbox | not a failure — delivery is async; `queued` is normal |

---

# Architecture rules (preserve these when editing)

- **Core proxy is asymmetric.** Inbox list/thread read core's OWN Supabase directly (`hyperflow-core/src/services/whatsapp.ts`) — hyper-wa already wrote those rows; no hop. Only `POST /v1/whatsapp/send` proxies to hyper-wa (`flow-ai.ts` S2S pattern: `fetch(HYPER_WA_BASE_URL + '/v1/messages', { headers: { 'X-Internal-Key' } })`). Map upstream errors: `409→whatsapp_window_closed`, `422→whatsapp_no_number`, other→`502 whatsapp_upstream_error`.
- **Tenant isolation:** a conversation fetched by `:id` MUST also match the session `workspace_id` → return **404** (not 403) so existence isn't leaked across tenants.
- **24h window opens on INBOUND.** Free-text send before any inbound → `409`. Outside the window you need an approved template via `POST /v1/conversations/start` (Content API). That endpoint deliberately skips the window check (it's the cold-start path) and does NOT reopen the 24h window — only the candidate's reply does.
- **One sandbox number → exactly one workspace.** `wa_numbers.channel_number` is read with `.maybeSingle()`; the same number can't map to two workspaces. Reassigning the row moves WhatsApp (the old workspace loses it).
- **Dev runs `tsx watch src/index.ts`** — a broad `pkill -f "tsx watch"` kills hyper-wa AND hyperflow-core at once. Kill by port: `kill $(ss -ltnp | grep :8080 | grep -oP 'pid=\K[0-9]+')`.

## Feature gate (show the inbox only where usable)

The bandeja is hidden unless the workspace has a mapped number — no hardcoded ids:
- Core `GET /v1/workspaces/:id/flags` returns `whatsapp_enabled = exists(wa_numbers where workspace_id = :id)` (`workspaceHasWhatsApp`, same pattern as `ecommerce_connected`).
- App: `WorkspaceFlags.whatsapp_enabled` defaults `false`; route wrapped in `FeatureRoute`; sidebar item filtered by the flag.
- This is a **UI gate, not a hard backend block** — `/v1/whatsapp/*` stays reachable but returns empty / `422` for workspaces without a number (data is workspace-scoped, so no leak). If a hard block is required, gate the route in core too.

## DB schema (Supabase; RLS = members read, service_role manages)

- `wa_numbers` — `workspace_id`, `channel_number` (E.164), `subaccount_sid?`. Routing + send-from. Service-role writes, members read.
- `wa_conversations` — `workspace_id`, `linked_entity_type?` / `linked_entity_id?` (generic entity link), `wa_phone`, `channel_number`, `status`, `last_message_at`, `window_expires_at`.
- `wa_messages` — `conversation_id`, `workspace_id`, `direction`, `provider_sid` (idempotency key), `from_phone`, `to_phone`, `body`, `num_media`, `media`, `status`, `error_code`.

**Generic entity link (V2).** The engine is entity-agnostic: it stores `linked_entity_type` + `linked_entity_id`, NOT `contact_id`/`company_id`. The `HostAdapter` (selected by `HOST_APP`) decides what to match: HyperFlow → `'contact'` (contacts), TeamUp → `'candidato'` (candidatos). Matching is best-effort (last 10 digits, MX; HyperFlow also does an exact `phone_e164` pass); no match → link is `null`. Never blocks ingest.

- HyperFlow Supabase: migration `hyperflow-core/migrations/20260622000000_wa_inbox.sql` (V1) + `20260626000000_wa_linked_entity.sql` (V2: adds `linked_entity_*`, backfills from `contact_id`, keeps old columns during transition).
- TeamUp Supabase: migration `teamup/supabase/migrations/20260626_001_wa_inbox.sql` (born generic; RLS via the `is_workspace_member` helper; private `wa-media` bucket).

# V2 — portability (second app: TeamUp) + templates

The V2 proved the engine generalizes by wiring a *second* consumer. Gotchas it surfaced:

- **One codebase, N instances, picked by `HOST_APP`.** Each app runs its OWN hyper-wa instance with its OWN `.env`: its `SUPABASE_URL`/`SERVICE_ROLE_KEY` (that app's DB only), its Twilio subaccount, its `INTERNAL_KEY`, and `HOST_APP=hyperflow|teamup`. `HOST_APP` selects the `HostAdapter` in `src/host/index.ts`. Adding a 3rd app = a new adapter file + one `case` (don't build a dynamic registry until a 3rd case actually needs it — the 2-case rule).
- **Blast radius is contained per instance.** A leaked secret in one instance never touches the other app's DB or numbers. Don't assume "already done in HyperFlow" — each instance owns its `workspace_id` and its keys.
- **TeamUp proxies from a Deno Edge Function**, not a Node core. `teamup/supabase/functions/whatsapp/index.ts` validates the user JWT + workspace membership (owner OR `workspace_members`, via `profiles.id`), then `fetch`es hyper-wa with `X-Internal-Key`. Same trust boundary as core, different runtime — proof the "service, not library" call was right. The browser still never holds `INTERNAL_KEY`. Deploy with `--no-verify-jwt` (it validates the token itself).
- **Outbound-first needs templates.** Recruiters message candidates who never wrote first → no open window → an approved template is mandatory. `provider.sendTemplate` (Content API: `contentSid` + `contentVariables`) + `POST /v1/conversations/start`. Approval is a **Meta lead-time dependency (days), not code** — start it in parallel.
- **Subaccounts are per-instance, not per-message.** A Twilio subaccount per app = the instance's `TWILIO_ACCOUNT_SID`. `wa_numbers.subaccount_sid` stays informational; don't build per-workspace subaccount routing until a real case needs it.
- **Reads vs sends in TeamUp.** The inbox UI reads `wa_*` straight from Supabase via RLS (`is_workspace_member`); only sends/template-starts go through the Edge Function. Mirror of HyperFlow's asymmetric proxy.

# Sandbox setup (runnable)

1. Twilio console → subaccount → copy `ACCOUNT_SID`, `AUTH_TOKEN`; create a **Standard** API key (or Restricted + `Messages:Create`).
2. Fill `hyper-wa/.env` (Rule 0). `INTERNAL_KEY` = invent one; reuse the same in core.
3. `ngrok http 8080` → put the exact tunnel URL in `PUBLIC_BASE_URL`.
4. Twilio sandbox settings → "When a message comes in": `<PUBLIC_BASE_URL>/webhooks/twilio/inbound` (POST); status callback: `/webhooks/twilio/status`.
5. From the test phone, send `join <code>` to the sandbox number (opt-in; without it Twilio drops the message).
6. Seed `wa_numbers` (step 3 of the inbound playbook) → map `+14155238886` to a workspace.
7. Verify:
```bash
curl -s "$PUBLIC_BASE_URL/healthz"          # {"ok":true,"service":"hyper-wa"}
# reply within the window (hyper-wa direct):
curl -X POST http://localhost:8080/v1/messages \
  -H "X-Internal-Key: $(grep ^INTERNAL_KEY .env|cut -d= -f2-|tr -d '\"')" \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"<uuid>","to":"+52...","body":"hola"}'   # 201 queued
```

For production hosting (replaces ngrok with a stable URL), see `hyper-wa-deploy-railway.html`. Railway ≠ leaving the sandbox — that's Meta/V2 (real number + business verification + templates), started in parallel.

## Endpoints
- hyper-wa: `POST /v1/messages` (X-Internal-Key) · `POST /v1/conversations/start` (X-Internal-Key, template) · `POST /webhooks/twilio/inbound` · `POST /webhooks/twilio/status` · `GET /healthz`
- HyperFlow core: `GET /v1/whatsapp/conversations` · `GET /v1/whatsapp/conversations/:id/messages` · `POST /v1/whatsapp/send`
- TeamUp Edge Function `whatsapp` (POST, body `{action:'send'|'start', ...}`); reads go straight to Supabase via RLS.

## Pre-flight checklist
- [ ] `.env` gitignored in every repo (`git check-ignore .env`); no `AC/SK`/service_role literal in committed source.
- [ ] `INTERNAL_KEY` identical in hyper-wa and core (`HYPER_WA_INTERNAL_KEY`).
- [ ] `PUBLIC_BASE_URL` equals the URL Twilio actually calls (exact).
- [ ] `wa_numbers` has a row for the channel number → target workspace.
- [ ] Test phone has done `join`.
- [ ] Cycle proven: inbound lands in `wa_messages`; outbound returns `201` and reaches the phone.
- [ ] Reads scoped by `workspace_id`; cross-tenant `:id` → 404.
