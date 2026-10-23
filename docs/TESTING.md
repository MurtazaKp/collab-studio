# Testing

| Command | What it covers | External services |
| --- | --- | --- |
| `npm run test:unit` | Shared models (mindmap cycles/orphans, whiteboard merges, code files, ordering, tokens, validation) and web helpers | none |
| `npm run test:db` | All migrations + RLS/RPC/trigger behaviour on an embedded Postgres (PGlite) with a Supabase shim | none |
| `npm run test:collab` | Real Hocuspocus server + separate WebSocket clients per user against the migrated PGlite DB | none |
| `npm run test:e2e` | Playwright: smoke tests always; multi-user browser tests when configured | optional |
| `npm run typecheck`, `npm run lint`, `npm run build` | Static checks and production builds | none |

`npm test` runs unit + DB + collaboration suites.

## Why PGlite

Local Supabase (`supabase start`) needs Docker. The DB suite instead applies the real migration files to [PGlite](https://pglite.dev) (Postgres 17 in WASM) after `supabase/tests/support/supabase-shim.sql`, which recreates the parts of Supabase our SQL relies on: the `anon`/`authenticated`/`service_role` roles with Supabase's default grants, `auth.users` + `auth.uid()`, `storage.objects` + `storage.foldername()`, `realtime.messages` + `realtime.topic()`, and the `supabase_realtime` publication. Queries run inside a transaction after `set local role authenticated` and setting `request.jwt.claims`, exactly as PostgREST does, so RLS is genuinely exercised (tests assert the `row-level security` errors).

The shim is not a substitute for testing against a real project: GoTrue, PostgREST, Realtime and Storage servers themselves are only exercised by the multi-user E2E suite.

## Database suite (`supabase/tests`)

- **migrations.test.ts** — migrations + seed apply to an empty DB; every public table has RLS; Yjs tables are excluded from Realtime; private bucket exists; every `SECURITY DEFINER` function pins `search_path`; demo seed builds a complete workspace.
- **workspace-access.test.ts** — an outsider cannot read 11 private tables or profiles, cannot insert/update/delete, cannot self-join, cannot call privileged RPCs; cross-workspace injection through composite FKs is rejected; anonymous users see nothing; the owner/admin/member/viewer matrix; ownership transfer; forged `created_by`; immutable `workspace_id`; non-member assignees; version checks; invalid payloads (CHECK constraints); a removed member immediately loses read and write access.
- **invitations.test.ts** — token stored only as hash; accepted once by the intended verified recipient with the invited role; other users, unverified emails, expired, revoked, re-used, malformed and unknown tokens are rejected; owner/unknown roles and excessive expiry refused; in-app acceptance by id; only managers see invitations; direct inserts blocked.
- **modules-data.test.ts** — chat authorship/threads/edits/unread/reactions; playlist URL validation (`javascript:`, `data:` …); shopping check attribution; activity/notification triggers and anti-forgery; storage object policies; private realtime topic policies; the `collab_server` role can resolve access and read/write Yjs state but nothing else.
- **kanban.test.ts** — atomic `create_board`; `move_task` version conflict, cross-board FK rejection, viewer denial, activity logging.

## Collaboration suite (`apps/collab/test`)

Each test uses separately authenticated `HocuspocusProvider` clients (different users, separate sockets):

- concurrent edits from two users converge and the DB alone reproduces the content;
- offline edits on both sides merge after a simulated network drop;
- a new client (page refresh) restores confirmed changes;
- viewers get `readonly` scope and their writes never reach other clients or the DB;
- outsiders with correctly signed tokens, forged/expired/wrong-room/garbage/empty tokens, malformed room names and disabled modules are rejected;
- a removed member's *open* session is closed (`access-revoked`), later writes are not applied, and reconnecting is refused;
- downgrades force a reconnect (`role-changed`);
- disallowed WebSocket origins get 403;
- state survives a graceful restart;
- acknowledged-but-unflushed updates are recovered from clients after a crash;
- appends retry through a simulated DB outage;
- simultaneous first visitors of new mindmap/code rooms get exactly one seeded root/file;
- previews and last editor are written to entity rows;
- compaction under concurrent appends never loses updates; `/health` reports status.

`web-adapter.test.ts` drives the **web app's own client module** (`apps/web/src/lib/collab/hocuspocus.ts`) against the server: it syncs when the shared socket opened before the room was joined (the page-load order in the app — this caught a socket-retry misconfiguration that left every editor loading forever), two users converge and see each other's presence, one session is shared per room, denial surfaces an error instead of a spinner, revocation is reported, and a role change re-authenticates into read-only.

## Browser E2E (`e2e/`)

`e2e/smoke.spec.ts` needs nothing external: health endpoint, security headers, anonymous visitors never reach workspace pages, and the collaboration-token endpoint never issues tokens anonymously.

`e2e/multiuser/collaboration.spec.ts` maps to the acceptance criteria using **three users in separate browser contexts** (Alice, Bob, Carol): onboarding + workspace creation; invitation bound to recipient (wrong account refused, re-use refused); concurrent document editing with convergence, offline edit recovery and reload; whiteboard objects; Kanban create/move (dnd-kit keyboard)/edit; chat delivery + persistence; mindmap; Monaco convergence; playlist; shopping both ways; dashboard previews; viewer restrictions; a removed member being kicked from an open document.

To run it you need a **disposable test Supabase project** with the migrations applied, the web app and collaboration server pointed at it, and:

```bash
export E2E_SUPABASE_URL=https://<test-ref>.supabase.co
export E2E_SUPABASE_SERVICE_ROLE_KEY=<test project service-role key>   # test-only; creates confirmed users
export E2E_BASE_URL=http://localhost:3000                               # or omit to auto-start `next start` on :3100
npx playwright install chromium
npm run test:e2e
```

Global setup creates three random, email-confirmed users per run via the Auth admin API; their credentials are written to `e2e/.auth/` (gitignored). Without these variables the multi-user tests are reported as **skipped** — never as passed.

## Latest results (this environment)

Recorded on 2026-10-21, Windows 11, Node 22.14:

| Suite | Result |
| --- | --- |
| Unit (shared + web) | 31 passed |
| Database (PGlite) | 73 passed |
| Collaboration server + web adapter | 25 passed |
| Playwright smoke | 4 passed |
| Playwright multi-user | 13 **skipped** (no Supabase test project available) |
| `tsc --noEmit` (all packages) | clean |
| ESLint (web) | 0 errors, 12 warnings (`react-hooks/set-state-in-effect`, intentional external-system sync) |
| `next build` / `tsup` | success |
