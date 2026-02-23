# Chat Feature

This feature owns chat-domain UI and lifecycle orchestration.

Current modules:

- `components/chat-message-list.tsx`
- `components/chat-destructive-confirm-dialog.tsx`
- `components/chat-input.tsx` and `components/chat-input/*`
- `hooks/*` for stream, retry, scroll, and pending-generation orchestration.

Guideline:

- Keep chat-specific components and hooks here instead of top-level `src/components` or `src/hooks`.
