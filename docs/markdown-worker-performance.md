# Markdown worker implementation

Markdown parsing, GFM processing, KaTeX generation, and completed-code syntax highlighting now run in a lazily created shared Web Worker. React turns the resulting structured syntax tree into DOM elements on the main thread. Plain streaming paragraphs retain their existing direct-render path, and finished paragraphs remain frozen while a response streams.

The queue runs one parse at a time, removes cancelled pending revisions, waits for a startup handshake, ignores obsolete results, and terminates an idle worker after 30 seconds. It releases stalled requests after 15 seconds. Replacement replies immediately show their own source; append updates retain the previous rendered prefix until the latest formatting is ready. Completion schedules a full-document parse so reference definitions resolve across paragraphs. No assistant source is passed to `innerHTML` or `dangerouslySetInnerHTML`.

If workers are unavailable, fail to load, or time out, the same parser loads dynamically on the main thread. The initial SSR/hydration view shows readable source until formatting completes. This introduces an asynchronous formatting delay and may briefly show Markdown punctuation when opening rich messages.

Completed documents now use an exact-source in-memory LRU cache (40 entries,
8 MiB estimated source/tree bytes, 512 KiB maximum per entry). Streaming trees
are excluded. A cached remount avoids another parse and the initial plaintext
view. Each renderer clones its visible tree once so custom components receiving
`node` cannot modify a shared cache entry. Account changes clear the cache even
when no composer is mounted. These limits are estimates rather than heap measurements.

## Measured result

Run `npm run benchmark:markdown-worker`. The benchmark uses headless Chromium, 28,080 source characters containing 120 code/math/table blocks, five warm rounds, and median measurements. The UI case includes React/DOM updates; it excludes application layout/styles and AI/network latency. Local results from 2 October 2026:

| Workload | Main-thread parsing | Worker parsing |
| --- | ---: | ---: |
| Parsing only: largest frame gap | 110.9 ms | 22.6 ms |
| Parsing only: formatting round trip | 108.2 ms | 156.2 ms |
| React/DOM update: largest frame gap | 139.4 ms | 42.3 ms |
| React/DOM update: formatting round trip | 139.3 ms | 185.8 ms |

The measured UI frame gap decreased about 70% (roughly 3.3 times shorter). Formatting latency increased about 33% in the UI case. A cold worker parse took 317.1 ms. Results vary by device and document. This improves responsiveness during expensive formatting; it does not establish a 100% whole-app speedup or reduce model generation latency.

## Framework packaging and verification

Next.js 16.3.5 Turbopack resolves two dependencies to DOM-only browser implementations even inside worker bundles. `next.config.ts` aliases the entity decoder and KaTeX HTML-to-tree conversion to equivalent DOM-free implementations. Knip lists these alias targets as entry points because it does not trace those configuration references. The esbuild browser fixtures use the packages' native `worker` export condition.

Run `npm run build` followed by `npm run check:markdown-worker-build` to exercise the actual optimized Next worker chunks in Chromium. This check uses local built assets and confirms entities, math, Markdown, and highlighting without a document global. The parser parity tests compare rendered output with ReactMarkdown, including structured cloning, raw HTML, unsafe URLs, nested constructs, incomplete fences, Unicode, and code source. Queue tests cover cancellation, startup, timeouts, errors, and idle teardown. Browser tests cover real worker execution, fallback, streaming completion, replacements, and exact code copying. Existing stop/recovery tests also run through the real worker.
