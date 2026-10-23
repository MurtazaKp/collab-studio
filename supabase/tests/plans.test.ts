import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  addMember,
  asUser,
  count,
  createTestDb,
  createUser,
  createWorkspace,
  expectError,
  setPlan,
  type TestUser,
} from "./support/db";

let db: PGlite;
let staff: TestUser;
let owner: TestUser;

async function grantAdmin(user: TestUser) {
  // Exactly what docs/ADMIN.md tells operators to run in the SQL editor.
  await db.query(`insert into public.platform_admins (user_id, note) select id, 'test' from auth.users where email = $1`, [user.email]);
}

async function subscription(ws: string) {
  const r = await db.query<{ plan_id: string; status: string; trial_ends_at: string | null; notes: string }>(
    `select plan_id, status, trial_ends_at, notes from workspace_subscriptions where workspace_id = $1`,
    [ws],
  );
  return r.rows[0];
}

async function invite(as: TestUser, ws: string, email: string) {
  return asUser(db, as, async (tx) => {
    const r = await tx.query<{ invitation_id: string; token: string }>(`select * from create_invitation($1, $2, 'member')`, [ws, email]);
    return r.rows[0]!;
  });
}

beforeAll(async () => {
  db = await createTestDb();
  staff = await createUser(db, "Staff");
  owner = await createUser(db, "Owner");
  await grantAdmin(staff);
});

describe("default plan", () => {
  it("puts every new workspace on Free, active", async () => {
    const ws = await createWorkspace(db, owner, "New Co");
    expect(await subscription(ws)).toMatchObject({ plan_id: "free", status: "active", trial_ends_at: null });
  });

  it("switches off modules outside Free when a workspace is created with all of them", async () => {
    const ws = await createWorkspace(db, owner, "All Modules Co");
    const r = await db.query<{ module_type: string }>(
      `select module_type from workspace_modules where workspace_id = $1 and enabled order by position`,
      [ws],
    );
    expect(r.rows.map((x) => x.module_type)).toEqual(["docs", "kanban", "chat", "shopping"]);
  });

  it("seeds plans that match the pricing page", async () => {
    const r = await db.query<{ id: string; monthly_price_cents: number; max_members: number; storage_mb: number }>(
      `select id, monthly_price_cents, max_members, storage_mb from plans order by sort_order`,
    );
    expect(r.rows).toEqual([
      { id: "free", monthly_price_cents: 0, max_members: 3, storage_mb: 100 },
      { id: "team", monthly_price_cents: 2900, max_members: 15, storage_mb: 10240 },
      { id: "business", monthly_price_cents: 7900, max_members: 50, storage_mb: 51200 },
    ]);
  });

  it("members can read their own subscription and usage; clients cannot change it", async () => {
    const ws = await createWorkspace(db, owner, "Usage Co");
    const outsider = await createUser(db, "Outsider");
    const usage = await asUser(db, owner, (tx) =>
      tx.query<{ plan_id: string; member_count: number; max_members: number; writable: boolean; usage: Record<string, number> }>(
        `select * from workspace_usage($1)`,
        [ws],
      ),
    );
    expect(usage.rows[0]).toMatchObject({ plan_id: "free", member_count: 1, max_members: 3, writable: true });
    expect(usage.rows[0]!.usage.chat).toBe(1); // #general
    expect(await expectError(asUser(db, outsider, (tx) => tx.query(`select * from workspace_usage($1)`, [ws])))).toMatch(/Not a member/);
    // Subscription rows carry internal notes, so not even members read them directly.
    for (const who of [outsider, owner]) {
      await expectError(asUser(db, who, (tx) => tx.query(`select notes from workspace_subscriptions where workspace_id = $1`, [ws])));
    }

    await expectError(asUser(db, owner, (tx) => tx.query(`update workspace_subscriptions set plan_id = 'business' where workspace_id = $1`, [ws])));
    await expectError(asUser(db, owner, (tx) => tx.query(`insert into platform_admins (user_id) values ($1)`, [owner.id])));
    expect((await subscription(ws))!.plan_id).toBe("free");
  });
});

describe("member limit", () => {
  it("blocks invitations and acceptance once the Free plan's 3 people are in", async () => {
    const ws = await createWorkspace(db, owner, "Small Co");
    const second = await createUser(db, "Second");
    const third = await createUser(db, "Third");
    const fourth = await createUser(db, "Fourth");

    const toSecond = await invite(owner, ws, second.email);
    const toThird = await invite(owner, ws, third.email);
    const toFourth = await invite(owner, ws, fourth.email);
    await asUser(db, second, (tx) => tx.query(`select accept_invitation($1)`, [toSecond.token]));
    await asUser(db, third, (tx) => tx.query(`select accept_invitation($1)`, [toThird.token]));

    // Full: the fourth person's (earlier) invitation can't be accepted ...
    const accept = await expectError(asUser(db, fourth, (tx) => tx.query(`select accept_invitation($1)`, [toFourth.token])));
    expect(accept).toMatch(/Free plan allows up to 3 people/);
    expect(await count(db, `select 1 from workspace_members where workspace_id = $1`, [ws])).toBe(3);
    // ... and no new invitations can be sent.
    expect(await expectError(invite(owner, ws, "fifth@example.test"))).toMatch(/allows up to 3 people/);

    // Upgrading lifts the limit.
    await setPlan(db, ws, "team");
    await asUser(db, fourth, (tx) => tx.query(`select accept_invitation($1)`, [toFourth.token]));
    expect(await count(db, `select 1 from workspace_members where workspace_id = $1`, [ws])).toBe(4);
  });

  it("raises a recognisable SQLSTATE and hint for the web app", async () => {
    const ws = await createWorkspace(db, owner, "Hint Co");
    for (const name of ["H1", "H2"]) await addMember(db, ws, await createUser(db, name), "member");
    const err = await asUser(db, owner, (tx) => tx.query(`select * from create_invitation($1, 'x@example.test', 'member')`, [ws])).catch(
      (e: { code?: string; hint?: string }) => e,
    );
    expect(err).toMatchObject({ code: "PT402", hint: "plan_member_limit" });
  });
});

describe("item limits and module access", () => {
  it("allows 25 documents per module on Free, then refuses the next one", async () => {
    const ws = await createWorkspace(db, owner, "Busy Co");
    await asUser(db, owner, async (tx) => {
      for (let i = 0; i < 25; i++) await tx.query(`insert into documents (workspace_id, title) values ($1, $2)`, [ws, `Doc ${i}`]);
    });
    const msg = await expectError(asUser(db, owner, (tx) => tx.query(`insert into documents (workspace_id, title) values ($1, 'One too many')`, [ws])));
    expect(msg).toMatch(/Free plan allows up to 25 documents/);
    // Other modules have their own allowance, and existing items stay editable.
    await asUser(db, owner, (tx) => tx.query(`select create_board($1, 'Roadmap')`, [ws]));
    const renamed = await asUser(db, owner, (tx) => tx.query(`update documents set title = 'Doc zero' where workspace_id = $1 and title = 'Doc 0'`, [ws]));
    expect(renamed.affectedRows).toBe(1);

    await setPlan(db, ws, "team");
    await asUser(db, owner, (tx) => tx.query(`insert into documents (workspace_id, title) values ($1, 'Room to grow')`, [ws]));
    expect(await count(db, `select 1 from documents where workspace_id = $1`, [ws])).toBe(26);
  });

  it("refuses items and module switches for tools outside the plan", async () => {
    const ws = await createWorkspace(db, owner, "Basic Co");
    const wb = await expectError(asUser(db, owner, (tx) => tx.query(`insert into whiteboards (workspace_id, title) values ($1, 'Sketch')`, [ws])));
    expect(wb).toMatch(/Whiteboard isn't included in the Free plan/);
    const on = await expectError(
      asUser(db, owner, (tx) => tx.query(`update workspace_modules set enabled = true where workspace_id = $1 and module_type = 'code'`, [ws])),
    );
    expect(on).toMatch(/Code isn't included in the Free plan/);
  });

  it("a downgrade keeps existing content readable but makes its rooms read-only", async () => {
    const ws = await createWorkspace(db, owner, "Downgrade Co");
    await setPlan(db, ws, "team");
    const wb = await asUser(db, owner, (tx) => tx.query<{ id: string }>(`insert into whiteboards (workspace_id, title) values ($1, 'Kept') returning id`, [ws]));
    const room = `whiteboard:${wb.rows[0]!.id}`;
    await db.query(`update workspace_subscriptions set plan_id = 'free' where workspace_id = $1`, [ws]);
    expect(await asUser(db, owner, (tx) => count(tx, `select 1 from whiteboards where workspace_id = $1`, [ws]))).toBe(1);
    const access = await db.query<{ role: string }>(`select role from collab.room_access($1, $2)`, [room, owner.id]);
    expect(access.rows[0]!.role).toBe("viewer");
  });

  it("treats a lapsed trial as Free", async () => {
    const ws = await createWorkspace(db, owner, "Lapsed Co");
    await db.query(
      `update workspace_subscriptions set plan_id = 'team', status = 'trialing', trial_ends_at = now() - interval '1 day' where workspace_id = $1`,
      [ws],
    );
    expect(await expectError(asUser(db, owner, (tx) => tx.query(`insert into mindmaps (workspace_id, title) values ($1, 'Plan')`, [ws])))).toMatch(
      /Free plan/,
    );
  });

  it("enforces the storage quota on attachments", async () => {
    const ws = await createWorkspace(db, owner, "Files Co");
    await db.query(`update plans set storage_mb = 1 where id = 'free'`);
    try {
      const path = (n: number) => `${ws}/00000000-0000-4000-8000-00000000000${n}/f${n}.pdf`;
      const add = (n: number, bytes: number) =>
        asUser(db, owner, (tx) =>
          tx.query(`insert into attachments (workspace_id, storage_path, file_name, mime_type, size_bytes) values ($1, $2, 'f.pdf', 'application/pdf', $3)`, [
            ws,
            path(n),
            bytes,
          ]),
        );
      await add(1, 700_000);
      expect(await expectError(add(2, 400_000))).toMatch(/used its 1 MB of file storage/);
    } finally {
      await db.query(`update plans set storage_mb = 100 where id = 'free'`);
    }
  });
});

describe("suspended and canceled workspaces", () => {
  let ws: string;
  let member: TestUser;
  let docId: string;

  beforeAll(async () => {
    ws = await createWorkspace(db, owner, "Paused Co");
    member = await createUser(db, "PausedMember");
    await addMember(db, ws, member, "member");
    docId = (await asUser(db, member, (tx) => tx.query<{ id: string }>(`insert into documents (workspace_id, title) values ($1, 'Before') returning id`, [ws]))).rows[0]!.id;
    await asUser(db, staff, (tx) => tx.query(`select admin_set_status($1, 'suspended', 'Chargeback')`, [ws]));
  });

  it("are readable but refuse every write with a clear message", async () => {
    expect(await asUser(db, member, (tx) => count(tx, `select 1 from documents where workspace_id = $1`, [ws]))).toBe(1);
    const writes: [string, unknown[]][] = [
      [`insert into documents (workspace_id, title) values ($1, 'After')`, [ws]],
      [`update documents set title = 'Changed' where id = $1`, [docId]],
      [`delete from documents where id = $1`, [docId]],
      [`insert into messages (workspace_id, channel_id, body) select $1, id, 'hi' from channels where workspace_id = $1`, [ws]],
      [`update workspaces set name = 'Renamed' where id = $1`, [ws]],
      [`select * from create_invitation($1, 'late@example.test', 'member')`, [ws]],
    ];
    for (const [sql, params] of writes) {
      const as = sql.includes("workspaces set") || sql.includes("create_invitation") ? owner : member;
      expect(await expectError(asUser(db, as, (tx) => tx.query(sql, params)))).toMatch(/suspended, so it's read-only/);
    }
  });

  it("make collaboration rooms read-only", async () => {
    const access = await db.query<{ role: string }>(`select role from collab.room_access($1, $2)`, [`document:${docId}`, member.id]);
    expect(access.rows[0]!.role).toBe("viewer");
  });

  it("can still be deleted by the owner", async () => {
    const doomed = await createWorkspace(db, owner, "Doomed Co");
    await asUser(db, owner, (tx) => tx.query(`insert into documents (workspace_id, title) values ($1, 'x')`, [doomed]));
    await db.query(`update workspace_subscriptions set status = 'canceled' where workspace_id = $1`, [doomed]);
    expect(await expectError(asUser(db, owner, (tx) => tx.query(`insert into documents (workspace_id, title) values ($1, 'y')`, [doomed])))).toMatch(
      /canceled, so it's read-only/,
    );
    await asUser(db, owner, (tx) => tx.query(`select delete_workspace($1)`, [doomed]));
    expect(await count(db, `select 1 from workspaces where id = $1`, [doomed])).toBe(0);
  });

  it("become writable again when reactivated", async () => {
    await asUser(db, staff, (tx) => tx.query(`select admin_set_status($1, 'active')`, [ws]));
    await asUser(db, member, (tx) => tx.query(`insert into documents (workspace_id, title) values ($1, 'After')`, [ws]));
  });
});

describe("admin RPCs", () => {
  const calls: [string, (ws: string) => unknown[]][] = [
    [`select * from admin_overview()`, () => []],
    [`select * from admin_list_workspaces()`, () => []],
    [`select * from admin_get_workspace($1)`, (ws) => [ws]],
    [`select * from admin_workspace_members($1)`, (ws) => [ws]],
    [`select * from admin_list_audit_log()`, () => []],
    [`select admin_set_plan($1, 'business')`, (ws) => [ws]],
    [`select admin_set_status($1, 'suspended')`, (ws) => [ws]],
    [`select admin_extend_trial($1, 14)`, (ws) => [ws]],
    [`select admin_set_notes($1, 'pwned')`, (ws) => [ws]],
  ];

  it("are refused for signed-in non-admins, including workspace owners, and for anon", async () => {
    const ws = await createWorkspace(db, owner, "Target Co");
    for (const [sql, params] of calls) {
      expect(await expectError(asUser(db, owner, (tx) => tx.query(sql, params(ws))))).toMatch(/Platform admin access required/);
      await expectError(asUser(db, null, (tx) => tx.query(sql, params(ws))));
    }
    expect(await subscription(ws)).toMatchObject({ plan_id: "free", status: "active", notes: "" });
    expect(await asUser(db, owner, (tx) => tx.query<{ ok: boolean }>(`select is_platform_admin() as ok`))).toMatchObject({ rows: [{ ok: false }] });
    // The audit log and admin list are not readable directly either.
    expect(await asUser(db, owner, (tx) => count(tx, `select 1 from admin_audit_log`)).catch(() => 0)).toBe(0);
    expect(await asUser(db, owner, (tx) => count(tx, `select 1 from platform_admins`)).catch(() => 0)).toBe(0);
  });

  it("let a platform admin manage a customer, and record every change", async () => {
    const ws = await createWorkspace(db, owner, "Customer Co");
    expect(await asUser(db, staff, (tx) => tx.query<{ ok: boolean }>(`select is_platform_admin() as ok`))).toMatchObject({ rows: [{ ok: true }] });

    const ends = await asUser(db, staff, (tx) => tx.query<{ ends: string }>(`select admin_extend_trial($1, 14) as ends`, [ws]));
    expect(await subscription(ws)).toMatchObject({ plan_id: "team", status: "trialing" });
    expect(new Date(ends.rows[0]!.ends).getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);

    await asUser(db, staff, async (tx) => {
      await tx.query(`select admin_set_plan($1, 'business')`, [ws]);
      await tx.query(`select admin_set_status($1, 'active')`, [ws]);
      await tx.query(`select admin_set_notes($1, 'Annual contract, invoiced')`, [ws]);
      // Unchanged values are not logged twice.
      await tx.query(`select admin_set_plan($1, 'business')`, [ws]);
    });
    expect(await subscription(ws)).toMatchObject({ plan_id: "business", status: "active", trial_ends_at: null, notes: "Annual contract, invoiced" });
    expect(await expectError(asUser(db, staff, (tx) => tx.query(`select admin_set_plan($1, 'platinum')`, [ws])))).toMatch(/Unknown plan/);
    expect(await expectError(asUser(db, staff, (tx) => tx.query(`select admin_extend_trial($1, 365)`, [ws])))).toMatch(/1 to 90 days/);

    const log = await asUser(db, staff, (tx) =>
      tx.query<{ action: string; actor_email: string; workspace_name: string }>(`select * from admin_list_audit_log($1)`, [ws]),
    );
    expect(log.rows.map((r) => r.action).sort()).toEqual(["notes_updated", "plan_changed", "status_changed", "trial_extended"]);
    expect(log.rows.every((r) => r.actor_email === staff.email && r.workspace_name === "Customer Co")).toBe(true);
  });

  it("list, search, filter and summarise customers", async () => {
    const ws = await createWorkspace(db, owner, "Searchable Widgets");
    await asUser(db, owner, (tx) => tx.query(`insert into documents (workspace_id, title) values ($1, 'One')`, [ws]));
    await asUser(db, staff, (tx) => tx.query(`select admin_set_plan($1, 'team')`, [ws]));

    const found = await asUser(db, staff, (tx) =>
      tx.query<{ workspace_id: string; owner_email: string; plan_id: string; member_count: number; item_count: number; total_count: number }>(
        `select * from admin_list_workspaces('widgets')`,
      ),
    );
    expect(found.rows).toHaveLength(1);
    expect(found.rows[0]).toMatchObject({ workspace_id: ws, owner_email: owner.email, plan_id: "team", member_count: 1, item_count: 2 });
    // Search by owner email, filter by plan, and LIKE wildcards are literal.
    expect(await asUser(db, staff, (tx) => count(tx, `select * from admin_list_workspaces($1)`, [owner.email]))).toBeGreaterThan(1);
    expect(await asUser(db, staff, (tx) => count(tx, `select * from admin_list_workspaces('', 'team', 'active')`))).toBeGreaterThanOrEqual(1);
    expect(await asUser(db, staff, (tx) => count(tx, `select * from admin_list_workspaces('%')`))).toBe(0);

    const detail = await asUser(db, staff, (tx) =>
      tx.query<{ usage: Record<string, number>; member_count: number; max_members: number }>(`select * from admin_get_workspace($1)`, [ws]),
    );
    expect(detail.rows[0]).toMatchObject({ member_count: 1, max_members: 15 });
    expect(detail.rows[0]!.usage).toMatchObject({ docs: 1, chat: 1 });

    const overview = await asUser(db, staff, (tx) =>
      tx.query<{ total_workspaces: number; mrr_cents: number; by_plan: { plan_id: string; workspaces: number }[]; by_status: Record<string, number> }>(
        `select * from admin_overview()`,
      ),
    );
    const o = overview.rows[0]!;
    const total = await count(db, `select 1 from workspaces`);
    expect(Number(o.total_workspaces)).toBe(total);
    expect(o.by_plan.map((p) => p.plan_id)).toEqual(["free", "team", "business"]);
    expect(o.by_plan.reduce((n, p) => n + Number(p.workspaces), 0)).toBe(total);
    expect(Object.keys(o.by_status).sort()).toEqual(["active", "canceled", "past_due", "suspended", "trialing"]);
    const expectedMrr = await db.query<{ n: number }>(
      `select coalesce(sum(p.monthly_price_cents), 0)::int as n from workspace_subscriptions s join plans p on p.id = s.plan_id where s.status in ('active','past_due')`,
    );
    expect(Number(o.mrr_cents)).toBe(expectedMrr.rows[0]!.n);
  });

  it("logs platform admin grants made in the database", async () => {
    const r = await db.query<{ action: string; details: { email: string } }>(`select action, details from admin_audit_log where action = 'admin_granted'`);
    expect(r.rows.map((x) => x.details.email)).toContain(staff.email);
  });

  it("keep the billing seam closed to clients", async () => {
    const ws = await createWorkspace(db, owner, "Billing Co");
    await expectError(asUser(db, owner, (tx) => tx.query(`select billing_apply_provider_update($1, 'business', 'active')`, [ws])));
    await expectError(asUser(db, staff, (tx) => tx.query(`select billing_apply_provider_update($1, 'business', 'active')`, [ws])));
  });
});
