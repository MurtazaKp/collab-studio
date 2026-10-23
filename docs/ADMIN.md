# Platform admin, plans and limits

CollabVerse staff manage customers from the admin console at **`/admin`**. Each
workspace (a customer's "room") has a plan and a subscription status, and the
database enforces the plan's limits for every request.

Everything here comes from `supabase/migrations/20261023000009_platform_admin_billing.sql`.

## Granting the first platform admin

Platform admins are rows in `public.platform_admins`. No client can write that
table (RLS on, no policies, privileges revoked), so admins are granted only from
the database: the Supabase **SQL editor** (which runs as `postgres`) or a
service-role connection.

1. Sign up in the app with the account that should become an admin, and confirm its email.
2. In the SQL editor, run:

   ```sql
   insert into public.platform_admins (user_id, note)
   select id, 'First platform admin'
   from auth.users
   where email = 'you@yourcompany.com'
   on conflict (user_id) do nothing;
   ```

3. Check it worked (it should return exactly one row):

   ```sql
   select a.user_id, u.email, a.granted_at
   from public.platform_admins a join auth.users u on u.id = a.user_id;
   ```

4. Sign in as that user and open `/admin`. A link to the console also appears on the
   "Your workspaces" page for admins.

To revoke: `delete from public.platform_admins where user_id = '<uuid>';`.
Grants and revocations are written to the admin audit log automatically.

Anyone who isn't a platform admin gets a **404** at `/admin` and every page under it.

## How the console talks to the database

The web app **never** uses the service-role key. The console runs with the
admin's own session and calls `SECURITY DEFINER` RPCs that check
`is_platform_admin()` before doing anything, then record the change:

| RPC | What it does |
| --- | --- |
| `admin_overview()` | Totals, workspaces by plan and status, estimated MRR |
| `admin_list_workspaces(search, plan, status, limit, offset)` | Customers list with owner email, plan, status, member and item counts |
| `admin_get_workspace(id)` / `admin_workspace_members(id)` | Customer detail and its members |
| `admin_set_plan(id, plan)` | Change plan |
| `admin_set_status(id, status, reason)` | `active`, `past_due`, `canceled` or `suspended` (suspend / reactivate) |
| `admin_extend_trial(id, days)` | Start or extend a trial (1–90 days); a Free workspace moves to a Team trial |
| `admin_set_notes(id, notes)` | Internal notes (max 2000 characters) |
| `admin_list_audit_log(id?, limit)` | The audit log, optionally for one workspace |

All of them are revoked from `public` and `anon`. Every change writes a row to
`admin_audit_log` (actor, action, workspace, before/after) — append-only and
readable only through `admin_list_audit_log()`.

## Plans and the limits they enforce

Derived from `apps/web/src/components/marketing/plans.ts` and the pricing page.
`apps/web/src/lib/plans.test.ts` fails if the two drift apart.

| | Free | Team | Business |
| --- | --- | --- | --- |
| Price (per workspace) | $0 | $29/mo or $290/yr | $79/mo or $790/yr |
| People (members) | 3 | 15 | 50 |
| Items per tool | 25 | unlimited | unlimited |
| File storage | 100 MB | 10 GB | 50 GB |
| Tools | Docs, Kanban, Chat, TODO List | all 8 | all 8 |

Choices made where the pricing page is silent:

- **Free tools.** The page says Free doesn't include "All 8 tools" without naming
  which it has; Free gets the four core tools (Docs, Kanban, Chat, TODO List).
  Whiteboard, Mindmap, Code and Playlist need Team or Business.
- **Item limits.** The page names none. Free allows 25 top-level items per tool
  (documents, boards, channels, lists…); paid plans are unlimited.
- **Pending invitations** don't count toward the member limit; the check runs when
  an invitation is created and again when it is accepted.
- **Trials.** The marketing trial is a 14-day Team trial. New workspaces still start
  on **Free / active**; admins start trials from the console. When a trial ends
  the workspace falls back to Free limits (it is not locked).

### Status

| Status | Effect |
| --- | --- |
| `trialing`, `active` | Normal use within the plan |
| `past_due` | Normal use (grace period for a failed payment); still counted in estimated MRR and flagged in the console |
| `canceled`, `suspended` | **Read-only**: members can read everything; every create, edit and delete is refused, and collaboration rooms open read-only |

### Where it's enforced

In the database, so clients can't skip it:

- `create_invitation` / `accept_invitation*` — member limit and read-only.
- `enforce_workspace_plan` triggers on every content table — read-only, tools
  outside the plan, and item limits on the top-level item tables.
- `enforce_module_plan` on `workspace_modules` — tools outside the plan can't be
  switched on (they are switched off when a Free workspace is created).
- `enforce_storage_quota` on `attachments` — storage quota.
- `collab.room_access` — returns `viewer` when the workspace is read-only or its
  plan no longer includes the tool, so the collaboration server makes the room
  read-only (including for editors already connected).

Requests with no signed-in user (the collaboration server, service-role jobs)
are not metered. Downgrading never deletes anything: existing content stays
readable, and new content is refused until the workspace is back under its limits.

Errors use SQLSTATE `PT402` (limits) or `PT403` (read-only) with a hint
(`plan_member_limit`, `plan_item_limit`, `plan_module`, `plan_storage`,
`plan_inactive`). The web app turns them into a toast with an **Upgrade** link to
`/pricing` (`apps/web/src/lib/plan-errors.ts`, `lib/notify-error.tsx`). Workspace
settings show the plan, status and usage against each limit.

## Payment provider seam (not connected)

There is no payment integration yet; plans and statuses change only through the
console. When Stripe (or similar) is added:

- Run the webhook handler **outside the web app** (for example a Supabase Edge
  Function) with the service role, and verify the provider's signature.
- Map checkout / subscription / invoice events to a plan and status and call
  `public.billing_apply_provider_update(workspace_id, plan_id, status, current_period_end, customer_id, subscription_id)`.
  It is executable by `service_role` only, stores the provider ids on
  `workspace_subscriptions`, never lifts a suspension, and writes a
  `billing_synced` audit entry.
