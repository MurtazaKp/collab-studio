# CollabVerse architecture

## Overview

```
 Browser (Next.js client)
 ├─ Supabase JS ──────────── HTTPS (PostgREST, Auth, Storage) ──► Supabase
 │                         └ WSS  (Realtime: Postgres Changes, presence) ──► Supabase Realtime
 └─ Collaboration adapter ── WSS  (Yjs sync + awareness) ──────► apps/collab (Hocuspocus)
                                                                    │
 Next.js server (Vercel)                                             │ least-privilege
 ├─ Server components / actions ── user's JWT ──► Supabase (RLS)    │ `collab_server` role
 └─ /api/collab/token ── signs 2-minute room tokens (HS256)          ▼
                                                                Supabase Postgres
```

Three responsibilities are kept apart:

| Layer | What it owns | Where |
| --- | --- | --- |
| Application | Pages, routing, workspace navigation, server-side authorization checks, UI state | `apps/web` (Next.js App Router, React 19) |
| Application data | Users, memberships, invitations, structured content, notifications, files | Supabase Postgres + Auth + Storage, `supabase/migrations` |
| Collaboration | Conflict-free concurrent editing and presence for rich text, canvas, mindmap and code | Yjs; `apps/collab` (Hocuspocus 4) behind a provider-neutral adapter |

## Repository layout

```
apps/web          Next.js app (UI, server actions, route handlers)
apps/collab       Hocuspocus collaboration server (independently deployable)
packages/shared   Pure TS shared by both: roles, module registry, room names,
                  collab tokens, validation schemas, ordering, Yjs data models
supabase/         migrations, seed.sql, config.toml, PGlite-based DB tests
e2e/              Playwright smoke + multi-user browser tests
scripts/          type generation, demo seeding
```

## Data model

Normalised tables (see `supabase/migrations`):

- **Identity & tenancy:** `profiles`, `workspaces`, `workspace_members` (role ∈ owner/admin/member/viewer, exactly one owner), `invitations` (SHA-256 token hash, expiry, single use, bound to an email).
- **Configuration:** `workspace_modules` (one row per module type; `enabled`, small validated `config`), `dashboard_layouts` (per user, validated JSON array).
- **Yjs-backed items:** `documents`, `whiteboards`, `mindmaps`, `code_projects`, each with a `collaboration_rooms` row (exactly-one-FK, cascade delete) holding the Yjs state in `collaboration_updates` (append log) and `collaboration_snapshots` (compacted state). Derived `preview_text` is written back by the collaboration server.
- **Relational modules:** `boards` → `board_columns` → `tasks` (+ `comments`, `attachments`); `channels` → `messages` (one-level threads) + `message_reactions` + `channel_reads`; `playlists` → `playlist_items`; `shopping_lists` → `shopping_items`.
- **Feeds:** `activity_events`, `notifications` — written only by triggers.

Integrity rules enforced in the database:

- Composite foreign keys `(parent_id, workspace_id) → parent(id, workspace_id)` make cross-workspace references impossible whatever a client sends.
- `workspace_id` is immutable on every row; `created_by`/`author_id`/`user_id` are overwritten with `auth.uid()`.
- CHECK constraints mirror the zod schemas (lengths, enums, `http(s)` URLs, fractional-index keys, attachment MIME/size).
- Ordered lists use fractional-index `position` keys (`COLLATE "C"`), so a move rewrites one row.
- `tasks.version` / `shopping_items.version` are bumped by trigger for optimistic concurrency (`move_task` RPC and `update … where version = ?`).

## Authorization

1. **Database (authoritative).** RLS on every public table. Helper functions (`is_workspace_member`, `can_edit_workspace`, `can_manage_workspace`) are `SECURITY DEFINER` with an empty `search_path`. All membership changes go through RPCs that re-derive the caller from `auth.uid()` and check roles explicitly; there are no client write policies on `workspace_members` or `invitations`.
2. **Next.js server.** Server components load data with the user's own session (`createServerSupabase`), so RLS applies to server code too. The service-role key is never used by the app. Server actions validate inputs with zod before calling RLS-protected tables or RPCs.
3. **Collaboration server.** See below — it re-checks membership itself.
4. **Storage.** Private `attachments` bucket; object keys are `<workspace_id>/<uuid>/<file>`, and storage policies check membership/role on the first path segment. Downloads use 60-second signed URLs.
5. **Realtime.** Postgres Changes are filtered by each subscriber's RLS. Presence/typing use *private* channels `ws:<workspace_id>` authorised by policies on `realtime.messages`.

Module gating (disabled modules) is enforced in page routes (404) and by the collaboration server (`module-disabled`); data stays in place when a module is disabled.

## Collaboration layer

### Provider-neutral contract

`apps/web/src/lib/collab/types.ts` defines `CollaborationProvider` (join/release/destroy) and `CollabSession` (doc, awareness, state, reconnect). Module components only use `useCollabRoom(room)`; Hocuspocus is confined to `lib/collab/hocuspocus.ts`. All rooms share one multiplexed WebSocket; sessions are reference-counted so the dashboard preview and a module page share one Y.Doc.

### Authentication flow

1. Client calls `POST /api/collab/token { room }`.
2. The route resolves the room through `collaboration_rooms` with the user's RLS session (non-members get 404) and signs a JWT (`sub`, `room`, 120 s TTL) with `COLLAB_JWT_SECRET`.
3. The collaboration server verifies signature, issuer, audience, expiry and that `room` matches the requested document, **then** calls `collab.room_access(room, user)` to get the current role and module state. Viewers get `connection.readOnly`, so Hocuspocus rejects their updates server-side.
4. Every 15 s (`COLLAB_RECHECK_INTERVAL_MS`) all open sessions are re-authorised. Removed members / disabled modules are closed with `access-revoked`; role changes close with `role-changed`, which the client handles by reconnecting with a fresh token (and therefore the new scope).

### Persistence and durability

`apps/collab/src/persistence.ts`:

- Every Yjs update is buffered per room and appended as one merged row within `COLLAB_FLUSH_INTERVAL_MS` (150 ms). Writes per room are serialised; failures re-queue and retry with backoff (nothing is dropped).
- Compaction (after 200 rows, on Hocuspocus' debounced store) runs in one transaction: lock snapshot, read existing log rows, merge, upsert snapshot, **delete exactly those row ids**. Rows appended concurrently survive. Loading applies snapshot + all remaining rows; Yjs makes re-application idempotent, so commit order never matters.
- New mindmap/code rooms are seeded server-side and persisted before the first client syncs, so simultaneous first visitors can't create duplicate roots/files.
- Crash window: updates are acknowledged once applied in memory. If the process dies within the flush window, clients still hold those updates and re-send them in the next sync handshake (state-vector exchange). Covered by `apps/collab/test/collab.test.ts › recovers acknowledged-but-unflushed updates`.
- Graceful shutdown (SIGTERM) flushes pending stores and the update buffer before exiting.
- **Single instance per room.** Hocuspocus keeps documents in memory; run one collaboration server instance (sufficient for the beta). Horizontal scaling would need the Hocuspocus Redis extension.

### Shared state models (`packages/shared`)

| Module | Y.Doc layout | Conflict behaviour |
| --- | --- | --- |
| Docs | `XmlFragment("default")` via Tiptap + `@tiptap/y-tiptap` | Character-level CRDT merge |
| Code | `Map("files")` of metadata, `Map("contents")` of `Y.Text` per file, bound with `y-monaco` | Character-level merge; file names validated |
| Whiteboard | `Map("objects")` of per-object `Y.Map` | Independent fields merge; same field LWW; connectors to deleted objects are dropped on read; strokes immutable |
| Mindmap | `Map("nodes")` of per-node `Y.Map` with `parentId` | Edges derived from `parentId`; orphans and cycles from concurrent edits are resolved deterministically by `normalizeMindmap` |

The whiteboard is a custom SVG canvas over this shared-object model (pan/zoom, sticky notes, text, rectangles, ellipses, connectors, freehand drawing via `perfect-freehand`), chosen because it integrates with Yjs directly and avoids a commercial canvas licence.

### Structured modules (Kanban, Chat, Playlist, Shopping)

Persisted rows are the source of truth; Supabase Realtime Postgres Changes push inserts/updates/deletes. `useLiveRows` subscribes *before* loading and reloads after every (re)subscription, on `online` and on tab focus, so events missed while disconnected are recovered. Out-of-order events are ignored using `version`/`updated_at`. Chat additionally catches up by fetching everything since the oldest loaded message, sends optimistically with client-generated UUIDs (deduplicated against realtime echoes) and supports keyset pagination.

## Security notes

- Invitation tokens: 244 random bits, stored only as SHA-256, 7-day default expiry, single use, accepted only by a verified account whose email matches.
- No code execution: the code module stores and displays text; Monaco runs with the base editor worker only.
- User content rendering: Tiptap links restricted to http(s)/mailto; chat links are rendered only for `http(s)` URLs with `rel="noopener noreferrer nofollow"`; playlist URLs are constrained in the database.
- Headers: CSP (connect-src limited to Supabase and the collaboration server), `X-Frame-Options: DENY`, `nosniff`, HSTS in production.
- Logs: the collaboration server logs ids, roles and sizes only — never tokens or content.
- Email links use `NEXT_PUBLIC_SITE_URL` (not the request Host header); password-reset and sign-up responses don't reveal whether an account exists.
