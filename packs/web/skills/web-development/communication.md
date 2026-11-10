# Client ↔ server communication — web

Principles A2, P2, P3, U2 from `.fxmind/policy/web-principles.md`.

## §1 Where to fetch

- Use the framework's data mechanism before hand-written effects: server components / `load` / loaders / `getServerSideProps` / `useFetch` / `asyncData`.
- In client components use the project's server-state library (React Query, SWR, Apollo, RTK Query). Avoid `useEffect(() => fetch(...))` with manual loading flags — it misses caching, deduplication, race handling and error states.
- Fetch in parallel what doesn't depend on each other (`Promise.all`, parallel loaders); avoid request waterfalls (component tree fetching level by level).
- One request per screen need, shaped by the server (a dedicated endpoint or include) instead of N requests per list item.

## §2 Client cache (A2, P3)

- Query keys include every parameter that changes the result (`['orders', { userId, page, status }]`).
- After a mutation, invalidate or update exactly the affected keys/tags (`invalidateQueries`, `revalidateTag`, `revalidatePath`, `mutate`) — not the whole cache, and never forget it (stale UI).
- Optimistic updates only when rollback on error is implemented.
- Don't copy fetched data into local/global state; read it from the cache.

## §3 Mutations (U2)

- Disable the submit while pending; prevent double submit; show success and failure.
- Handle every error class: validation errors next to fields, 401 → re-login flow, 403 → message, 409 → refresh/merge, network → retry option.
- Use the HTTP method that matches the action; never mutate on GET (prefetchers and crawlers follow links).

## §4 Race conditions and cancellation

- Fast-changing inputs (search-as-you-type) debounce and cancel the previous request (`AbortController`, library support) so an older response can't overwrite a newer one.
- Abort fetches on unmount/navigation when the library doesn't.
- Set timeouts on server-to-server calls; never wait forever on a third party.

## §5 Realtime

- Prefer polling with a sane interval or server-sent events for simple live updates; WebSockets when you need bidirectional, low-latency messages.
- Authenticate the connection and authorize each subscription/channel (S2).
- Send deltas/ids, not full datasets, and only to the clients that need them; reconnect with backoff and resync state after reconnect.
