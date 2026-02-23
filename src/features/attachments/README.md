# Attachments Feature

This feature owns attachment-type rules and attachment URL helpers used by upload/chat flows.

Current modules:

- `lib/attachments.ts`
- `lib/attachment-url.ts`
- `lib/attachment-route-utils.ts`
- `lib/attachment-signed-url.ts`
- `lib/attachment-cache.ts`

Guideline:

- Keep attachment-domain logic here instead of generic `src/lib`.
