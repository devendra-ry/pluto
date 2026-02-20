# Pluto

A fast, production-style AI workspace built on Next.js 16.

Pluto gives you one chat surface for multiple providers, plus dedicated generation modes for image, image edit, and image-to-video. It is optimized for realtime sync, secure request handling, and low-friction model expansion.

## What Makes It Good

- One model selector, multiple providers: Google, Chutes, OpenRouter.
- Mode-driven UX:
  - `Chat`
  - `Search` (Gemini 2.5 Flash / Flash Lite only)
  - `Image` (with inline image-model submenu)
  - `Image Edit`
  - `Image to Video`
- Attachment pipeline with server validation and ownership checks.
- Realtime message sync with Supabase + React Query canonical cache.
- Hardened API boundaries (auth + origin checks + JSON/schema checks + SSRF guard).

## Capability Snapshot

| Area | Implementation |
|---|---|
| Chat routing | Provider registry + model metadata |
| Streaming | SSE from `/api/chat` with transformation |
| Sync | Supabase Realtime + `@tanstack/react-query` |
| Uploads | Multipart-only, max `100MB`, MIME allowlist |
| Image Gen | Chutes-backed `/api/images` with model-specific payload mapping |
| Image Edit | Chutes Qwen image edit path with robust response parsing |
| Video Gen | Chutes WAN i2v path via `/api/videos` |
| Security | Auth middleware, CSRF-style origin checks, SSRF-safe media fetch |

## Current Image Generation Models

- `zai-org/z-image-turbo`
- `tencent/hunyuan-image-3`
- `Qwen/Qwen-Image-2512`
- `hidream/hidream`

The UI auto-populates this list inside the existing mode dropdown submenu.

## Architecture

```text
Client (chat page)
  -> optimistic message/update
  -> API route (/api/chat | /api/images | /api/videos)
  -> provider call (Google/Chutes/OpenRouter)
  -> stream or generated asset
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
- Google GenAI SDK, OpenRouter SDK, Chutes APIs

## Quick Start

### 1. Install and run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

### 2. Configure `.env.local`

```env
# Required
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
GEMINI_API_KEY=...

# Optional provider keys
CHUTES_API_KEY=...
CHUTES_API_TOKEN=...
OPENROUTER_API_KEY=...

# Optional origin configuration (recommended)
NEXT_PUBLIC_APP_URL=http://localhost:3000
APP_URL=http://localhost:3000
VERCEL_URL=

# Optional storage bucket override (default: chat-attachments)
SUPABASE_ATTACHMENTS_BUCKET=chat-attachments
NEXT_PUBLIC_SUPABASE_ATTACHMENTS_BUCKET=chat-attachments

# Optional SSRF allowlist extensions (comma-separated patterns)
CHUTES_MEDIA_FETCH_ALLOWED_HOSTS=

# Optional WAN i2v default negative prompt
CHUTES_WAN_I2V_NEGATIVE_PROMPT=
```

## Extending Image Models (Minimal UI Changes)

To add another Chutes image model, update three places:

1. Add model to `src/lib/constants.ts` -> `IMAGE_GENERATION_MODELS`.
2. Add endpoint candidates in `src/lib/chutes.ts`.
3. Add payload mapping in `src/app/api/images/route.ts` -> `getImageRequestAttempts(...)` if required.

No extra settings panel is needed; the mode dropdown submenu picks it up automatically.

### Optional endpoint override pattern

- `CHUTES_IMAGE_API_URL_<MODEL_ID_SUFFIX>`
- Example: `CHUTES_IMAGE_API_URL_QWEN_QWEN_IMAGE_2512=...`

## Useful Scripts

- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run db:types`

## Uptime Monitor Targets

- `GET /`
- `GET /login`

Note: most `/api/*` routes are authenticated by design; use an authenticated monitor if you check APIs directly.
