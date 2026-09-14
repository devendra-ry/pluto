# Pluto

A fast, production-style AI workspace built on Next.js 16.

Pluto gives you one chat surface for Google Gemini models. It is optimized for realtime sync, secure request handling, and low-friction model expansion.

Architecture details: see `ARCHITECTURE.md`.

## What Makes It Good

- One model selector for Google Gemini models.
- Reasoning effort and custom system prompts.
- Attachment pipeline with server validation and ownership checks.
- Realtime message sync with Supabase + React Query canonical cache.
- Hardened API boundaries (auth + origin checks + JSON/schema checks + SSRF guard).

## Capability Snapshot

| Area | Implementation |
|---|---|
| Chat routing | Provider registry + model metadata |
| Streaming | SSE from `/api/chat` with server-side persistence |
| Sync | Supabase Realtime + `@tanstack/react-query` |
| Uploads | Multipart-only, max `20MB` per file / `50MB` per generation, MIME allowlist |
| Security | Auth middleware, CSRF-style origin checks, and abuse protection |

## Architecture

```text
Client (chat page)
  -> optimistic message/update
  -> API route (/api/chat)
  -> provider call (Google)
  -> streamed response
  -> persist (Supabase DB/Storage)
  -> realtime fanout (Supabase Realtime)
  -> React Query cache updates UI
```

## Tech Stack

- Next.js 16 (App Router)
- React 19 + TypeScript
- Tailwind CSS v4 + shadcn/ui
- Supabase (auth, DB, storage, realtime)
- `@tanstack/react-query`
- Google GenAI SDK

## Quick Start

### 1. Install and run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

### 2. Apply database migrations

```bash
supabase link --project-ref <project-ref>
supabase db push
```

The ordered migration history is in `supabase/migrations`. For a local Supabase stack, run `supabase start` and `supabase db reset`.

### 3. Configure `.env.local`

```env
# Required
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
GEMINI_API_KEY=...

# Optional provider keys

# Required in production for distributed rate limits, request deduplication, and abuse protection
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
REDIS_KEY_PREFIX=pluto:dev

# Optional origin configuration (recommended)
NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_URL=http://localhost:3000
VERCEL_URL=

# Optional storage bucket override (default: chat-attachments)
SUPABASE_ATTACHMENTS_BUCKET=chat-attachments
NEXT_PUBLIC_SUPABASE_ATTACHMENTS_BUCKET=chat-attachments

# Optional model limits cache TTL in milliseconds (default: 1800000)
CHAT_LIMITS_CACHE_TTL_MS=1800000

```

## Useful Scripts

- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run test:e2e` (installs/runs Chromium through Playwright)
- `npm run db:types`

## Attachment URL lifecycle

The database stores stable, authenticated `/api/uploads` proxy URLs, never expiring signed URLs. Message loading requests short-lived Supabase signed URLs for display and opportunistically migrates older stored URLs back to the canonical proxy shape. Every upload read, write, and delete rechecks the authenticated user's thread ownership.

## Deployment checklist

- Apply `supabase/migrations` before deploying application code.
- Configure both Supabase public variables and the Gemini provider key.
- Configure Upstash Redis in production; request deduplication, rate limits, and abuse protection intentionally fail closed when it is unavailable.
- Set `APP_URL` or `NEXT_PUBLIC_APP_URL` to the canonical HTTPS origin.
- Keep the attachments bucket private and confirm its name matches both bucket environment variables.
- Run `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run test:e2e`, and `npm run build`.
- Review `npm audit --omit=dev` and `THIRD_PARTY_NOTICES.md` before release.

## Uptime Monitor Targets

- `GET /`
- `GET /login`

Note: most `/api/*` routes are authenticated by design; use an authenticated monitor if you check APIs directly.
