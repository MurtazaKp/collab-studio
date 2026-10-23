# Implementation plan and status

Environment found at start (2026-10-21): empty directory, no git repository, Node 22.14, npm 10.9, **no Docker or WSL** (so no local Supabase stack), no Supabase/Vercel credentials.

Consequences and decisions:

- Database behaviour is verified on PGlite with a Supabase shim (see TESTING.md) instead of `supabase start`.
- Collaboration is verified with a real Hocuspocus server and real WebSocket clients against that database.
- Browser tests that need GoTrue/PostgREST/Realtime are written and wired, and run when a test project is supplied.
- TypeScript is pinned to 5.9 (`latest` on npm is the Go-native 7.x, not yet supported by the Next/ESLint toolchain).

## Stack (verified versions)

Next.js 16.4 (App Router, Turbopack, `proxy.ts`), React 19.3, Tailwind CSS 4.3, Radix UI, Supabase JS 2.118 + `@supabase/ssr` 0.12, Yjs 13.6, Hocuspocus 4.7 (server + provider), Tiptap 3.32 (Collaboration + CollaborationCaret), `@xyflow/react` 12.12, dnd-kit (core 6 / sortable 10), Monaco 0.57 + y-monaco, zod 4, jose 6, Vitest 5, Playwright 1.64, PGlite 0.5.

Compatibility notes discovered while building:

- Hocuspocus 4 acknowledges updates after applying them in memory, not after persistence; `onChange` is not awaited → batched append log + client re-sync on reconnect (documented crash window).
- `HocuspocusProvider.destroy()` destroys the awareness it was given; the adapter detaches its listener first so editor bindings keep a live awareness across reconnects.
- Monaco 0.57's `exports` map rewrites `monaco-editor/*` to `esm/vs/*.js`: `y-monaco`'s legacy import is aliased in `next.config.ts`, and CSS is loaded via `features/codicon/register.js`.
- Tiptap 3's StarterKit already includes Link/Underline/ListKeymap and must have `undoRedo: false` under Yjs; task lists come from `@tiptap/extension-list`.
- Whiteboard: no canvas library was adopted (tldraw requires a commercial licence for production; Excalidraw's Yjs bindings are community-maintained). A documented shared-object model + SVG canvas was implemented instead.

## Phases

| # | Phase | Status |
| --- | --- | --- |
| 1 | Monorepo, design tokens/components, docs | ✅ |
| 2 | Migrations, RLS, auth flows (sign-up, verification, sign-in, reset, Google-optional), authorization RPCs, DB tests | ✅ |
| 3 | Workspaces, invitations (link + in-app), roles, transfer/delete, module registry | ✅ |
| 4 | Workspace shell, dashboard (live previews, per-user layout, add-module, pinning), module routes, activity, notifications | ✅ |
| 5 | Provider-neutral adapter, Hocuspocus server, token auth, revocation, durable persistence + compaction, presence | ✅ |
| 6 | Docs (Tiptap), Whiteboard (SVG/Yjs), Mindmap (React Flow), Code (Monaco) | ✅ |
| 7 | Kanban (dnd-kit, version checks, comments, attachments), Chat (threads, reactions, typing, unread, pagination, catch-up), Playlist, Shopping | ✅ |
| 8 | Loading/empty/error states, responsive shell, dark mode, accessibility labels | ✅ |
| 9 | Multi-client collaboration tests, security tests, E2E suite, deployment config | ✅ written; multi-user browser run blocked on credentials |

## Acceptance criteria → evidence

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | Register, sign in, create workspace | Auth server actions + onboarding; DB `create_workspace` tests; E2E #1 (needs project) |
| 2 | Invitations validate access | `invitations.test.ts` (12 cases); E2E #2 |
| 3 | Role enforcement server + DB | `workspace-access.test.ts` role matrix; collab viewer read-only test; E2E #3 |
| 4 | Concurrent document editing converges | collab "two authenticated users…"; E2E #4 |
| 5 | Whiteboard shared objects | shared model merge tests; E2E #5 |
| 6 | Kanban live create/edit/reorder/move | `kanban.test.ts`, live rows + `move_task`; E2E #6 |
| 7 | Chat persistent + delivered | `modules-data.test.ts` chat; E2E #7 |
| 8 | Mindmap sync + persist | shared mindmap tests, collab seeding test; E2E #8 |
| 9 | Code edits converge | shared code merge test; E2E #9 |
| 10–11 | Playlist / Shopping sync + persist | DB tests; E2E #10–11 |
| 12 | Dashboard previews = module data | widgets read the same tables / Yjs rooms; E2E #12 |
| 13 | Refresh keeps confirmed changes | collab "page refresh"; E2E #4 reload |
| 14 | Reconnect restores state | collab offline-merge + crash-recovery tests; E2E #4 offline |
| 15 | Removed member loses access in open session | DB revocation test; collab `access-revoked` test; shell watcher; E2E #15 |
| 16 | Reproducible migrations | `migrations.test.ts`; `supabase db push` |
| 17 | Build, types, lint, tests pass | see TESTING.md results |

## Known limitations / next steps

- Multi-user browser tests have not been executed (no Supabase test project in this environment).
- One collaboration-server instance per deployment (no Redis fan-out).
- Whiteboard text and mindmap labels are last-writer-wins per field (not character-merged).
- No email delivery of invitations: admins share the generated link; existing users also see an in-app notice.
- Supabase Realtime presence for typing indicators is best-effort (broadcast, not persisted) by design.
- Attachments are implemented for Kanban cards only.
- Chat has no @mention parsing or full-text search.
