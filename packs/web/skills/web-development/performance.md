# Performance — web

Principles P1–P3 (and D1, D2) from `.fxmind/policy/web-principles.md`.

## §1 Measure first (P1)

- Server: request timing logs/APM, slow query log, `EXPLAIN (ANALYZE)` for the query in question.
- Client: Lighthouse / Web Vitals (LCP, INP, CLS), browser Performance panel, React/Vue DevTools profiler, bundle analyzer (`next build` output, `vite-bundle-visualizer`, `source-map-explorer`).
- State the measurement (before/after) in Gate V when the task is a performance task. No speculative `useMemo`/`memo`/caching.

## §2 Server hot paths (P2)

- No queries in loops (D1) — batch, join, include, dataloader.
- No blocking sync I/O on the Node request path (`fs.readFileSync`, `execSync`, sync crypto/zlib, giant `JSON.parse` of files) — use async APIs or do it at startup.
- Heavy work (emails, image processing, reports, imports, third-party calls that can wait) → queue/job; respond fast.
- Middleware runs on every request — keep it cheap; don't hit the DB in global middleware unless cached.
- Set timeouts and limits on outbound calls; parallelize independent calls with `Promise.all`.

## §3 Rendering (P2)

- Server-render or statically generate what doesn't need the client; keep `"use client"` boundaries small (leaf components).
- Avoid re-render storms: stable props to memoized children, state lifted only as high as needed, context split by update frequency, long lists virtualized (> a few hundred rows).
- Don't compute expensive derived data on every render — compute on the server, or memoize after measuring.
- Images: framework image component or explicit `width`/`height`, modern formats, `loading="lazy"` below the fold, correct `sizes`. Reserve space for late content (CLS).
- Fonts: `font-display: swap`, self-host/subset via the framework font loader.

## §4 Bundle size (P2)

- Code-split routes and heavy widgets (charts, editors, maps) with dynamic import.
- Import only what you use (`import debounce from "lodash/debounce"`, not the whole library); prefer platform APIs (`Intl`, `fetch`, `URL`, `structuredClone`) over libraries.
- Server-only code and secrets must never be bundled for the client.
- Check the bundle report when adding a dependency to client code.

## §5 Caching (P3)

Every cache answers: **key**, **TTL**, **who invalidates it**, **is it per-user**.

| Layer | Use | Pitfall |
|-------|-----|---------|
| HTTP (`Cache-Control`, CDN) | public, static or slowly changing responses | caching personalized responses publicly |
| Framework data cache (`fetch` cache, `revalidate`, ISR, tags) | server-rendered data | forgetting `revalidateTag/Path` after mutations |
| App cache (Redis/memory) | expensive computations, third-party responses | key without user/tenant → data leak; no invalidation |
| Client server-state cache | screen data | stale data after mutation (see communication §2) |

- Cache-aside: read cache → miss → load → store with TTL; the mutation that changes the data deletes/updates the key.
- In-memory caches in serverless/multi-instance deployments are per instance — don't rely on them for consistency.
