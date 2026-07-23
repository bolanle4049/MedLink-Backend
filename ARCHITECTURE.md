# MedLink Backend — Architecture & Stack

Payment-blind WhatsApp triage backend. Patients interact entirely over WhatsApp
(no account); facility staff use a REST API + dashboard. The system gathers a
patient's complaint via AI, runs a deterministic safety layer, bands by urgency,
routes by coverage **after** banding, and surfaces cases to doctors in a
facility-scoped, urgency-sorted queue with a source-traced report.

> This document describes the `feat/spec-alignment-live-ai-twilio` branch (the
> version deployed on Render). See the note at the end about `main`.

---

## Stack

### Language & runtime
- **TypeScript 5.8** (target ES2022, CommonJS)
- **Node.js 20 LTS**

### Web / HTTP
- **Express 4** — REST API
- `cors`, `cookie-parser`, `multer` (multipart uploads)

### Database & ORM
- **PostgreSQL** — local Postgres in dev, **Neon** (serverless Postgres) in production
- **Prisma 6** (`@prisma/client` + `prisma`) — schema, client, `prisma db push` for schema sync
- `pg` (node-postgres) — direct access where needed
- Repository pattern over Prisma (`src/models/clinical.ts`, `src/database/repository.ts`)

### AI / LLM — provider-agnostic adapter (`src/services/ai/`)
- **Anthropic Claude** via `@anthropic-ai/sdk` — payment-blind text clinical interview, structured outputs; default `claude-haiku-4-5`
- **Google Gemini** via the **Interactions API** (raw REST, no SDK) — image / video / audio / PDF understanding; default `gemini-flash-latest`
- Config-driven routing: text → Claude, media → Gemini (override via `AI_TEXT_PROVIDER` / `AI_MEDIA_PROVIDER`)

### Messaging channel
- **Twilio WhatsApp** (sandbox) — signature-verified inbound webhook, outbound replies, authenticated media download

### Auth & security
- **JWT** (`jsonwebtoken`) bearer tokens + httpOnly `auth_token` cookie
- **bcryptjs** hashing; forced first-login reset; role-based access (`medlink_admin` / `facility_admin` / `doctor`); facility-scoped queries
- **Zod** request validation
- Twilio signature verification + Express `trust proxy`

### API docs & tooling
- **swagger-ui-express** + hand-authored **OpenAPI 3.0** → `/docs` and `/openapi.json`
- Built-in **`/console`** test UI (vanilla HTML/JS, served by the backend)

### Dev / build / test
- **tsx** — dev watch + test runner (Node's built-in `node:test`)
- **tsc** — production build to `dist/`
- **dotenv** — env config

### Deployment & infra
- **Docker** (`node:20-slim`)
- **Render** — web service from the Dockerfile (`render.yaml` blueprint)
- **Neon** — managed Postgres (`DATABASE_URL` secret)
- **ngrok** — local tunnel for Twilio during dev
- **Git / GitHub**

---

## Domain architecture

### Patterns
- **Adapter pattern** — AI providers behind one `AIProvider` interface (`src/services/ai/`)
- **Repository pattern** — data access over Prisma
- **Episode state machine** — `AwaitingConsent → Identifying → Interviewing → Confirming → Queued` (with `Critical` short-circuit, `Declined`, `Abandoned`), then `InReview → Resolved`

### Inbound request flow (WhatsApp → queue)
```
WhatsApp message ─▶ Twilio webhook (signature-verified)
      │
      ├─ media? ─▶ download (Twilio auth) ─▶ multimodal provider (Gemini)
      │                                       └─▶ text understanding
      ▼
episodeFlow.handleInboundMessage
      ├─ RESET keyword? ─▶ abandon + restart
      ├─ deterministic RED-FLAG layer (every message)  ─▶ Critical short-circuit
      ├─ state machine: consent → identity → coverage → interview (Claude) → confirm
      ├─ SATS-style banding (clinical data only — payment-blind)
      ├─ coverage routing + HMO adapter (AFTER banding) ─▶ facility
      └─ Queued  ─▶ facility-scoped, urgency-sorted doctor queue
```
Key invariant: the triage core (interview, red-flags, banding) never sees
coverage/HMO/facility data. Routing runs only after a band exists.

### Background
- In-process **escalation worker** auto-climbs a case's band when it waits past
  its threshold (recorded in the audit trail).

---

## Endpoints

Full contract with examples: **`/docs`** (Swagger UI) and **`/openapi.json`**.
Frontend integration guide: [`frontend_technical_spec.md`](./frontend_technical_spec.md).

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/register` · `/login` · `/first-login-reset` · `GET /api/auth/me` · `POST /api/auth/logout` |
| Cases | `GET /api/cases` · `GET /api/cases/:id` · `POST /api/cases/:id/claim` · `/override` · `/reply` |
| Facilities | `POST /api/facilities` · `POST/GET /api/facilities/:facilityId/doctors` · `POST /api/facilities/:facilityId/enrollees` · `GET /api/facilities/:facilityId/stats` |
| Intake | `POST /api/twilio/webhook` · `POST /api/twilio/simulate-patient` |
| System / tooling | `GET /health` · `GET /docs` · `GET /openapi.json` · `GET /console` |

---

## Running

### Local
```bash
npm install
npx prisma db push          # sync schema to DATABASE_URL
npm run dev                  # tsx watch (default PORT 7000; set 7100 to avoid macOS AirPlay)
```

### Environment (`.env` — see `.env.example`)
```
DATABASE_URL, JWT_SECRET, PORT
TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_NUMBER
ANTHROPIC_API_KEY, ANTHROPIC_MODEL
GEMINI_API_KEY, GEMINI_MODEL
AI_TEXT_PROVIDER, AI_MEDIA_PROVIDER
```

### Production (Render)
- Deploys from the **Dockerfile** via the `render.yaml` blueprint.
- Container start: `prisma db push` → `node dist/index.js`; binds Render's `PORT`.
- `DATABASE_URL` (Neon) + API keys are set as dashboard secrets.
- Twilio webhook → `https://<service>.onrender.com/api/twilio/webhook`.

### Build & test
```bash
npm run build     # prisma generate + tsc -> dist/
npm test          # tsx --test tests/**/*.test.ts
```

---

## Note on `main`

`main` currently holds a separate, parallel backend implementation (Gemini for
text intake, Redis for webhook dedup, Prisma called directly from controllers,
no Docker). This branch is a different architecture in the same filenames; the
two do not merge cleanly. Which implementation is canonical is an open decision
tracked on the PR.
