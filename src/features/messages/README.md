# Messages Feature

This feature owns message lifecycle state and operations.

Current modules:

- `hooks/use-messages.ts` for message query/cache/CRUD helpers.
- `hooks/use-message-subscription.ts` for realtime message updates.
- `lib/message-helpers.ts` for message mapping/sorting utilities.

Guideline:

- Message-specific data logic should live here instead of generic hook folders.
