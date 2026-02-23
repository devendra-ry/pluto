# Chat Feature

This feature owns chat-domain UI and lifecycle orchestration.

Current modules:

- `components/chat-message-list.tsx`
- `components/chat-destructive-confirm-dialog.tsx`
- `components/chat-empty-state.tsx`
- `components/chat-header.tsx`
- `components/chat-message.tsx` (+ assistant/user/action subcomponents)
- `components/chat-input.tsx` and `components/chat-input/*`
- `components/model-selector.tsx`
- `hooks/*` for stream, retry, scroll, and pending-generation orchestration.
- `lib/chat-controller.ts`, `lib/chat-service.ts`, `lib/chat-view.ts`, `lib/chat-attachments.ts`, and `lib/context-budget.ts`.

Guideline:

- Keep chat-specific components and hooks here instead of top-level `src/components` or `src/hooks`.
