# Features Folder

This folder holds domain-specific modules. Each feature should own:

- `components/` for feature UI pieces
- `hooks/` for feature state/lifecycle orchestration
- `services/` for feature API/data operations (when needed)
- `types/` for feature-only contracts (when needed)

Rules:

- Route files under `src/app` stay thin and import from feature modules.
- `src/shared` or `src/components/ui` should contain domain-agnostic primitives only.
- Cross-feature imports should go through stable APIs, not deep private internals.
