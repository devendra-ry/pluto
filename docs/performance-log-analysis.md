# Analyze chat performance logs

`server/chat/chat-controller.ts` writes one structured JSON record per event. The
offline summarizer reads the `[chat][perf]` events and reports the count, p50,
and p95 for each `*Ms` timing field, grouped by model. It also reports completed
and failed terminal streams per model. The first-provider-token event is counted
separately; its accumulated timings are omitted because the terminal record logs
those same values and including both would count one request twice.

Run it against a log file:

```sh
node scripts/summarize-chat-performance.mjs path/to/server.log
```

Or pipe logs from another tool:

```sh
some-log-export-command | node scripts/summarize-chat-performance.mjs
```

The parser ignores non-JSON lines, malformed JSON, unrelated messages, and
records explicitly marked `synthetic`, `testOnly`, `test`, or with a `test` or
`synthetic` environment/source. Do not label synthetic fixtures, browser tests,
or local microbenchmarks as production performance. For deployment comparisons,
use actual production log exports and compare equivalent models and request
populations. The summary includes no prompt, response, error, or other content
fields; it only prints timing fields and model IDs.

The package command accepts one optional filename and works with either
`npm run analyze:chat-logs -- path/to/server.log` or stdin.
