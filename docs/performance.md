# Performance

The optimizations target application overhead: rendering growing responses,
updating message caches, loading the sidebar, and reading Redis replay data.
Provider generation time and remote service latency still affect total response time.

## Reproduce the measurements

```sh
npm run benchmark:messages
npm run benchmark:markdown
```

Both scripts retain the previous algorithm as a baseline, warm both paths, and
report median timings. They run locally without provider credentials or database
writes. Results vary with machine load and do not measure total app speed.

Sample measurements on Windows, October 1, 2026:

| Workload | Previous | Optimized | Improvement |
| --- | ---: | ---: | ---: |
| One cached message update, 100 messages | 0.0089 ms | 0.0016 ms | 5.4x |
| One cached message update, 1,000 messages | 0.0852 ms | 0.0173 ms | 4.9x |
| One cached message update, 10,000 messages | 1.1922 ms | 0.1723 ms | 6.9x |
| 32 growing Markdown snapshots, prose | 178.7 ms | 130.5 ms | 1.37x |
| 32 growing Markdown snapshots, prose/code/math | 216.6 ms | 129.7 ms | 1.67x |

The Markdown benchmark isolates plugin selection. The app also memoizes completed
paragraphs and skips the reasoning Markdown tree while it is collapsed. Syntax
coloring is applied when a response finishes; Markdown formatting and math continue
to render during streaming. Finished-document equivalence is covered by tests.

## Request and startup changes

- Sidebar history starts from the user supplied by the server and the sidebar's
  auth listener, removing the extra client `getUser()` request. Supabase RLS still
  checks database access. User changes reset the history and realtime subscription.
- API block and rate checks run concurrently after authentication. Both must pass
  before the handler runs; block errors retain precedence. A blocked request may
  also increment its rate counter because both checks have started.
- Replay cache lookup uses one `XRANGE` instead of `XLEN` followed by `XRANGE`,
  saving one Redis round trip on cache hits. Cache misses still use one request.
  Incomplete streams remain rejected.
- Single-message cache updates preserve ordering with a scan and binary insertion,
  avoiding a Map rebuild and full-history sort. Batch and unsorted inputs retain
  the general merge path.

## Measure deployment performance

The chat controller logs `bodyParseMs`, `historyLoadMs`, `modelLimitsMs`,
`attachmentPreparationMs`, `providerConnectMs`, `providerFirstTokenMs`, and
`totalMs`. Compare p50/p95 for warm and cold requests with 0, 1, and 4 attachments.
Use Chromium's Performance panel to inspect long tasks while typing, scrolling,
expanding reasoning, and receiving a large code response.

Local benchmarks and unauthenticated browser smoke tests do not establish a 100x
improvement for the whole application. Authenticated generation, remote database
query plans, production network latency, and very long histories need deployment
measurements before making that claim.
