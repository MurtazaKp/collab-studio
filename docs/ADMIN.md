# Platform admin, plans and limits

CollabVerse staff manage customers from the admin console at **`/admin`**. A
**customer is an account** (a signed-up user). Each account has one plan and a
subscription status, and **every workspace the account owns runs on that
plan**. The database enforces the plan's limits for every request.

Everything here comes from
`supabase/migrations/20261023000009_platform_admin_billing.sql` (admins, plans,
enforcement) and `supabase/migrations/20261023000010_account_plans.sql` (plans
per account, workspace limits, the Custom plan).

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
| `admin_overview()` | Customers, workspaces, customers by plan and status, estimated MRR |
| `admin_list_customers(search, plan, status, limit, offset)` | Customers with plan, status, workspace count and people. With no search it lists accounts that own a workspace or have a plan/status set; a search finds any account by name, email, workspace name or id |
| `admin_get_customer(user_id)` | One customer's plan, status, limits, price and notes |
| `admin_customer_workspaces(user_id)` | The workspaces they own, with people, items, storage and pending invitations |
| `admin_workspace_members(workspace_id)` | Members of one workspace |
| `admin_set_plan(user_id, plan)` | Change plan (applies to all their workspaces) |
| `admin_set_status(user_id, status, reason)` | `active`, `past_due`, `canceled` or `suspended` (suspend / reactivate) |
| `admin_extend_trial(user_id, days)` | Start or extend a trial (1–90 days); a Free account moves to a Team trial |
| `admin_set_custom_price(user_id, cents)` | Monthly price for a Custom-plan customer (`null` clears it) |
| `admin_set_notes(user_id, notes)` | Internal notes (max 2000 characters) |
| `admin_transfer_workspace(workspace_id, new_owner, reason)` | Move a workspace to another account (they join as Owner; the old owner stays as Admin). The console's **Transfer** button finds the account by email. The new owner's plan must have room |
| `admin_list_audit_log(user_id?, limit)` | The audit log, optionally for one customer |

All of them are revoked from `public` and `anon`. Every change writes a row to
`admin_audit_log` (actor, action, customer, before/after), which is append-only
and readable only through `admin_list_audit_log()`.

## Plans and the limits they enforce

Derived from `apps/web/src/components/marketing/plans.ts` and the pricing page.
`apps/web/src/lib/plans.test.ts` fails if the two drift apart.

| | Free | Team | Business | Custom |
| --- | --- | --- | --- | --- |
| Price (per account) | $0 | $29/mo or $290/yr | $79/mo or $790/yr | Agreed per customer |
| Workspaces the account may own | 1 | 3 | 10 | unlimited |
| People in each workspace | 3 | 15 | 50 | unlimited |
| Items per tool, per workspace | 25 | unlimited | unlimited | unlimited |
| File storage per workspace | 100 MB | 10 GB | 50 GB | unlimited |
| Tools | Docs, Kanban, Chat, TODO List | all 8 | all 8 | all 8 |

- **Custom** is for organisations with many teams, sites or clients. Set its
  monthly price on the customer page (it counts as $0 in MRR until set). The
  pricing page's "Contact us" button goes to `NEXT_PUBLIC_SALES_URL` (for example
  `mailto:sales@yourdomain.com`); until that is set it starts a sign-up.
- **Free tools.** Free gets the four core tools (Docs, Kanban, Chat, TODO List).
  Whiteboard, Mindmap, Code and Playlist need a paid plan.
- **Pending invitations** don't count toward the member limit; the check runs when
  an invitation is created and again when it is accepted.
- **Trials.** The marketing trial is a 14-day Team trial. New accounts start on
  **Free / active**; admins start trials from the console. When a trial ends the
  account falls back to Free limits (it is not locked).
- **Members of someone else's workspace** use that workspace owner's plan, not
  their own. Joining a workspace never counts toward your own workspace limit.

### Who sees the plan

Only a workspace's **Owner and Admins** see its plan, price, limits and usage
(`workspace_usage()` refuses everyone else) and which modules are switched off
(members can read only enabled `workspace_modules` rows). Members and viewers
get just `workspace_write_state()` (is the workspace writable, and the account
status) so the app can explain read-only mode. When they hit a limit, they see
"Ask the workspace owner" instead of the plan name and an Upgrade link.

### Ownership

Workspace owners can only change through `transfer_ownership()` (the owner, to
an existing member) or `admin_transfer_workspace()` (platform admins). Clients
can update only a workspace's name, description, icon and colour, and a guard
trigger requires the new owner to be a member.

### Upgrades switch tools back on

When a Free account creates a workspace, the tools Free lacks are switched off
and flagged (`workspace_modules.plan_disabled`). When the account moves to a
plan that includes them (plan change, trial, reactivation or a billing update),
those tools are switched back on in every workspace the account owns. Tools an
owner switched off themselves stay off.

### Status

| Status | Effect |
| --- | --- |
| `trialing`, `active` | Normal use within the plan |
| `past_due` | Normal use (grace period for a failed payment); still counted in estimated MRR and flagged in the console |
| `canceled`, `suspended` | **Read-only** across every workspace the account owns: members can read everything; every create, edit and delete is refused, collaboration rooms open read-only, and no new workspaces can be created |

### Where it's enforced

In the database, so clients can't skip it:

- `enforce_workspace_count` on `workspaces` — workspaces per account, on create
  and on ownership transfer (the new owner needs room on their plan).
- `create_invitation` / `accept_invitation*` — member limit and read-only.
- `enforce_workspace_plan` triggers on every content table — read-only, tools
  outside the plan, and item limits on the top-level item tables.
- `enforce_module_plan` on `workspace_modules` — tools outside the plan can't be
  switched on.
- `enforce_storage_quota` on `attachments` — storage quota.
- The Storage upload policy (`can_upload_attachment`) — uploads need edit rights,
  a writable account and room in the quota, counting every file in the
  workspace's folder (including files never recorded as attachments).
- `limit_invitation_rate` on `invitations` — 30 invitations an hour per person.
- `collab.room_access` — returns `viewer` when the workspace is read-only or its
  plan no longer includes the tool, so the collaboration server makes the room
  read-only (including for editors already connected).

Requests with no signed-in user (the collaboration server, service-role jobs,
the SQL editor) are not metered. Downgrading never deletes anything: existing
workspaces and content stay readable, and new ones are refused until the
account is back under its limits.

Errors use SQLSTATE `PT402` (limits) or `PT403` (read-only) with a hint
(`plan_workspace_limit`, `plan_member_limit`, `plan_item_limit`, `plan_module`,
`plan_storage`, `plan_inactive`). The web app turns them into a message with a
link to `/pricing` (`apps/web/src/lib/plan-errors.ts`, `lib/notify-error.tsx`).
Workspace settings show the owner's plan, status and usage against each limit.

### Upgrading from per-workspace plans

Migration `20261023000010` replaces `workspace_subscriptions` with
`account_subscriptions`. Each workspace owner keeps the best plan any of their
workspaces had (writable statuses first, then the highest plan), workspace
notes are carried over, labelled by workspace, and tools switched off by the
old plans are switched back on where the new plan includes them. An owner who
already has more workspaces than their plan allows keeps them all, but can't
create more.

## Payment provider seam (not connected)

There is no payment integration yet; plans and statuses change only through the
console. When Stripe (or similar) is added:

- Run the webhook handler **outside the web app** (for example a Supabase Edge
  Function) with the service role, and verify the provider's signature.
- Map checkout / subscription / invoice events to a plan and status and call
  `public.billing_apply_provider_update(user_id, plan_id, status, current_period_end, customer_id, subscription_id)`.
  It is executable by `service_role` only, stores the provider ids on
  `account_subscriptions`, never lifts a suspension, and writes a
  `billing_synced` audit entry.
