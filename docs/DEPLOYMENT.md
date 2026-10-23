# Deployment

Three pieces, each deployable on a free or low-cost tier:

| Piece | Recommended host | Notes |
| --- | --- | --- |
| Web app (`apps/web`) | Vercel (Hobby/Pro) | Standard Next.js 16 deployment |
| Database, Auth, Storage, Realtime | Supabase (Free/Pro) | Migrations in `supabase/migrations` |
| Collaboration server (`apps/collab`) | Any always-on Node host with WebSockets: Render, Fly.io, Railway, a small VM | **Not** serverless — it holds WebSocket connections and in-memory Y.Docs |

Nothing has been deployed from this repository yet; the steps below are the reproducible path.

## 1. Supabase

1. Create a project. Note the project ref, URL and publishable (or anon) key.
2. Apply migrations:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push          # applies supabase/migrations/*.sql in order
   ```
3. **Collaboration role.** The migrations create a `NOLOGIN` role `collab_server` with access only to the Yjs tables and two `collab.*` functions. Give it a password (SQL editor):
   ```sql
   alter role collab_server with login password '<long random password>';
   ```
   Its connection string (Supavisor session pooler, port 5432):
   `postgresql://collab_server.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`
   (Using the `postgres` user also works but grants far more than the server needs.)
4. **Platform admin.** Grant yourself access to the admin console at `/admin` with the SQL snippet in [ADMIN.md](ADMIN.md#granting-the-first-platform-admin). Plans, limits and the billing seam are described there too.
5. **Auth → URL configuration:** Site URL = your app URL; add redirect URLs `https://<app>/auth/confirm` and `https://<app>/auth/callback` (plus `http://localhost:3000/...` for development).
6. **Auth → Email:** keep "Confirm email" on. The app handles both the default PKCE links and token-hash links. For token-hash templates (recommended, works across browsers):
   - Confirm signup: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding`
   - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
   The built-in email sender is rate-limited; configure custom SMTP before inviting beta users.
7. **Realtime:** Postgres Changes are enabled by the migration (publication). For presence/typing the app uses *private* channels; in Realtime settings, private channels must be allowed (policies are created by the migration).
8. **Google sign-in (optional):** enable the Google provider with your OAuth client, add `https://<ref>.supabase.co/auth/v1/callback` to Google's authorised redirect URIs, then set `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED=true` in the web app.
9. Types: `npx supabase gen types typescript --project-id <ref>` is compatible with `apps/web/src/lib/supabase/database.types.ts`, but `npm run db:types` (generated from the migrations) is what the repo uses.

## 2. Collaboration server

Environment (`apps/collab/.env.example`):

| Variable | Required | Description |
| --- | --- | --- |
| `COLLAB_DATABASE_URL` | yes | `collab_server` connection string (session pooler or direct) |
| `COLLAB_JWT_SECRET` | yes | ≥ 32 chars, identical to the web app's value (`openssl rand -hex 32`) |
| `COLLAB_ALLOWED_ORIGINS` | yes in prod | Comma-separated web origins, e.g. `https://collabverse.vercel.app` |
| `PORT` | no | Defaults to 1234 (most hosts inject it) |
| `COLLAB_RECHECK_INTERVAL_MS` | no | Membership re-check interval (15000) |
| `COLLAB_FLUSH_INTERVAL_MS` | no | Update-log batch window (150) |
| `COLLAB_COMPACT_THRESHOLD` | no | Rows before compaction (200) |
| `LOG_LEVEL` | no | `debug` / `info` / `warn` / `error` |

Options:

- **Docker (any host):** `docker build -f apps/collab/Dockerfile -t collabverse-collab .` from the repo root; the image exposes 1234 and has a `HEALTHCHECK` on `/health`.
- **Render:** `render.yaml` is a Blueprint for the Docker image (health check `/health`). Use a paid "Starter" instance: free instances sleep, which drops live sessions.
- **Plain Node:** `npm ci && npm run build -w @collabverse/collab && node apps/collab/dist/index.js`.

Run exactly **one** instance (documents live in memory; see ARCHITECTURE.md). The server handles SIGTERM by flushing everything to Postgres before exiting, so rolling restarts are safe; clients reconnect automatically.

Health: `GET /health` → `200 {"status":"ok","db":"ok","documents":n,"connections":n,"pendingUpdates":n}` or `503` when the database is unreachable. Logs are JSON lines on stdout.

## 3. Web app (Vercel)

1. Import the repository; set **Root Directory** to `apps/web` (Vercel detects npm workspaces and installs from the root).
2. Environment variables (Production and Preview):

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable (or legacy anon) key |
| `NEXT_PUBLIC_SITE_URL` | Public URL of the app |
| `NEXT_PUBLIC_COLLAB_URL` | `wss://<collab host>` |
| `COLLAB_JWT_SECRET` | Same as the collaboration server (server-only) |
| `NEXT_PUBLIC_AUTH_GOOGLE_ENABLED` | `true` only when Google is configured |

`NEXT_PUBLIC_*` values are inlined at build time (and feed the CSP), so redeploy after changing them. Never add the Supabase service-role key to the web app.
3. `GET /api/health` reports whether Supabase and collaboration are configured.

## 4. Smoke test after deploying

1. Sign up, confirm email, complete onboarding.
2. Invite a second account; accept from another browser.
3. Open the same document in both browsers and type in each.
4. Check `GET <collab>/health` shows the connections.

## Cost and quota monitoring (10–50 beta users)

- **Supabase Free:** 500 MB database, 1 GB storage, 2 GB egress, 200 concurrent Realtime connections, 2M Realtime messages/month; projects pause after a week of inactivity (Pro removes pausing). Watch *Database size* (Yjs logs are compacted; snapshots grow with content), *Realtime concurrent peak* (each open tab holds one Realtime socket) and *Auth emails*. Each tab also holds one collaboration WebSocket, which does not count against Supabase.
- **Vercel Hobby** is for non-commercial use; a paid beta should use Pro. Function usage is light (pages + token endpoint).
- **Collaboration host:** one small always-on instance (~256–512 MB RAM) comfortably serves this scale. Memory grows with the number of simultaneously open documents; `/health` exposes counts.
- Set budget alerts on each provider and check the Supabase *Usage* page weekly during the beta.
