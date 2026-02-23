# Uploads Feature

This feature owns client-side upload lifecycle helpers for thread attachments.

Current modules:

- `lib/uploads.ts` for upload start/cancel and attachment cleanup calls to `/api/uploads`.

Guideline:

- Keep attachment-upload orchestration here instead of generic shared/core folders.