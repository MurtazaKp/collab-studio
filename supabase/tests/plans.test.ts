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
  setAccountPlan,
  setPlan,
  type TestUser,
} from "./support/db";

let db: PGlite;
let staff: TestUser;

async function grantAdmin(user: TestUser) {
  // Exactly what docs/ADMIN.md tells operators to run in the SQL editor.
  await db.query(`insert into public.platform_admins (user_id, note) select id, 'test' from auth.users where email = $1`, [user.email]);
}

async function account(user: TestUser) {
  const r = await db.query<{ plan_id: string; status: string; trial_ends_at: string | null; notes: string; custom_price_cents: number | null }>(
    `select plan_id, status, trial_ends_at, notes, custom_price_cents from account_subscriptions where user_id = $1`,
    [user.id],
  );
  return r.rows[0];
}

async function invite(as: TestUser, ws: string, email: string) {
  return asUser(db, as, async (tx) => {
    const r = await tx.query<{ invitation_id: string; token: string }>(`select * from create_invitation($1, $2, 'member')`, [ws, email]);
    return r.rows[0]!;
  });
}

async function enabledModules(ws: string): Promise<string[]> {
  const r = await db.query<{ module_type: string }>(`select module_type from workspace_modules where workspace_id = $1 and enabled order by position`, [ws]);
  return r.rows.map((x) => x.module_type);
}

/** A fresh customer with one workspace, so tests don't share plan state. */
async function customer(name: string): Promise<{ owner: TestUser; ws: string }> {
  const owner = await createUser(db, name);
  return { owner, ws: await createWorkspace(db, owner, `${name} Co`) };
}

const ALL = ["docs", "whiteboard", "kanban", "chat", "mindmap", "code", "playlist", "shopping"];

beforeAll(async () => {
  db = await createTestDb();
  staff = await createUser(db, "Staff");
  await grantAdmin(staff);
});

describe("account plans", () => {
  it("gives every new account the Free plan, active", async () => {
    const user = await createUser(db, "Newcomer");
    expect(await account(user)).toMatchObject({ plan_id: "free", status: "active", trial_ends_at: null });
  });

  it("seeds plans that match the pricing page, including Custom", async () => {
    const r = await db.query<{ id: string; monthly_price_cents: number; max_members: number | null; storage_mb: number | null; max_workspaces: number | null }>(
      `select id, monthly_price_cents, max_members, storage_mb, max_workspaces from plans order by sort_order`,
    );
    expect(r.rows).toEqual([
      { id: "free", monthly_price_cents: 0, max_members: 3, storage_mb: 100, max_workspaces: 1 },
      { id: "team", monthly_price_cents: 3500, max_members: 15, storage_mb: 10240, max_workspaces: 3 },
      { id: "business", monthly_price_cents: 8900, max_members: 50, storage_mb: 51200, max_workspaces: 10 },
      { id: "custom", monthly_price_cents: 0, max_members: null, storage_mb: null, max_workspaces: null },
    ]);
  });

  it("switches off modules outside Free when a Free account creates a workspace", async () => {
    const { ws } = await customer("FreeMods");
    expect(await enabledModules(ws)).toEqual(["docs", "kanban", "chat", "shopping"]);
  });

  it("a new workspace of a paid account starts with every tool on", async () => {
    const owner = await createUser(db, "Payer");
    await setAccountPlan(db, owner, "business");
    const ws = await createWorkspace(db, owner, "Payer Co");
    expect(await enabledModules(ws)).toEqual(ALL);
  });

  it("members can read the plan their workspace runs on; clients cannot change it", async () => {
    const { owner, ws } = await customer("Usage");
    const outsider = await createUser(db, "Outsider");
    const usage = await asUser(db, owner, (tx) =>
      tx.query<{ plan_id: string; member_count: number; max_members: number; writable: boolean; usage: Record<string, number>; max_workspaces: number; owner_workspace_count: number; is_owner: boolean }>(
        `select * from workspace_usage($1)`,
        [ws],
      ),
    );
    expect(usage.rows[0]).toMatchObject({ plan_id: "free", member_count: 1, max_members: 3, writable: true, max_workspaces: 1, owner_workspace_count: 1, is_owner: true });
    expect(usage.rows[0]!.usage.chat).toBe(1); // #general
    expect(await expectError(asUser(db, outsider, (tx) => tx.query(`select * from workspace_usage($1)`, [ws])))).toMatch(/Not a member/);

    // Subscription rows carry internal notes, so not even the account owner reads them directly.
    await expectError(asUser(db, owner, (tx) => tx.query(`select notes from account_subscriptions where user_id = $1`, [owner.id])));
    await expectError(asUser(db, owner, (tx) => tx.query(`update account_subscriptions set plan_id = 'custom' where user_id = $1`, [owner.id])));
    await expectError(asUser(db, owner, (tx) => tx.query(`insert into platform_admins (user_id) values ($1)`, [owner.id])));
    expect((await account(owner))!.plan_id).toBe("free");
  });

  it("an admin of someone else's workspace sees the owner's plan, not their own", async () => {
    const { ws } = await customer("Host");
    await setPlan(db, ws, "business");
    const guest = await createUser(db, "Guest");
    await addMember(db, ws, guest, "admin");
    const usage = await asUser(db, guest, (tx) => tx.query<{ plan_id: string; is_owner: boolean }>(`select * from workspace_usage($1)`, [ws]));
    expect(usage.rows[0]).toMatchObject({ plan_id: "business", is_owner: false });
    expect((await account(guest))!.plan_id).toBe("free");
  });
});

describe("workspace limit", () => {
  it("allows 1 workspace on Free and 3 on Team, with a recognisable error", async () => {
    const { owner } = await customer("Grower");
    const err = await createWorkspace(db, owner, "Second").catch((e: { code?: string; hint?: string; message: string }) => e);
    expect(err).toMatchObject({ code: "PT402", hint: "plan_workspace_limit" });
    expect((err as Error).message).toMatch(/Free plan allows up to 1 workspace\./);

    await setAccountPlan(db, owner, "team");
    await createWorkspace(db, owner, "Second");
    await createWorkspace(db, owner, "Third");
    expect(await expectError(createWorkspace(db, owner, "Fourth"))).toMatch(/Team plan allows up to 3 workspaces/);
  });

  it("gives Custom unlimited workspaces", async () => {
    const owner = await createUser(db, "Enterprise");
    await setAccountPlan(db, owner, "custom");
    for (let i = 0; i < 25; i++) await createWorkspace(db, owner, `Site ${i}`);
    expect(await count(db, `select 1 from workspaces where owner_id = $1`, [owner.id])).toBe(25);
  });

  it("checks the new owner's allowance on ownership transfer", async () => {
    const { owner, ws } = await customer("Seller");
    const { owner: buyer } = await customer("Buyer");
    await addMember(db, ws, buyer, "admin");
    const msg = await expectError(asUser(db, owner, (tx) => tx.query(`select transfer_ownership($1, $2)`, [ws, buyer.id])));
    expect(msg).toMatch(/new owner's Free plan allows up to 1 workspace/);
    await setAccountPlan(db, buyer, "team");
    await asUser(db, owner, (tx) => tx.query(`select transfer_ownership($1, $2)`, [ws, buyer.id]));
    expect(await count(db, `select 1 from workspaces where owner_id = $1`, [buyer.id])).toBe(2);
  });

  it("a suspended account can't create workspaces", async () => {
    const owner = await createUser(db, "Frozen");
    await setAccountPlan(db, owner, "team", "suspended");
    expect(await expectError(createWorkspace(db, owner, "Nope"))).toMatch(/account is suspended/);
  });
});

describe("member limit", () => {
  it("blocks invitations and acceptance once the Free plan's 3 people are in", async () => {
    const { owner, ws } = await customer("Small");
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

    // Upgrading the owner's account lifts the limit.
    await setAccountPlan(db, owner, "team");
    await asUser(db, fourth, (tx) => tx.query(`select accept_invitation($1)`, [toFourth.token]));
    expect(await count(db, `select 1 from workspace_members where workspace_id = $1`, [ws])).toBe(4);
  });

  it("raises a recognisable SQLSTATE and hint for the web app", async () => {
    const { owner, ws } = await customer("Hint");
    for (const name of ["H1", "H2"]) await addMember(db, ws, await createUser(db, name), "member");
    const err = await asUser(db, owner, (tx) => tx.query(`select * from create_invitation($1, 'x@example.test', 'member')`, [ws])).catch(
      (e: { code?: string; hint?: string }) => e,
    );
    expect(err).toMatchObject({ code: "PT402", hint: "plan_member_limit" });
  });

  it("Custom has no member limit", async () => {
    const { owner, ws } = await customer("Big");
    await setAccountPlan(db, owner, "custom");
    for (let i = 0; i < 60; i++) await addMember(db, ws, await createUser(db, `Staff${i}`), "member");
    await invite(owner, ws, "one-more@example.test");
  });
});

describe("item limits and module access", () => {
  it("allows 25 documents per module on Free, then refuses the next one", async () => {
    const { owner, ws } = await customer("Busy");
    await asUser(db, owner, async (tx) => {
      for (let i = 0; i < 25; i++) await tx.query(`insert into documents (workspace_id, title) values ($1, $2)`, [ws, `Doc ${i}`]);
    });
    const msg = await expectError(asUser(db, owner, (tx) => tx.query(`insert into documents (workspace_id, title) values ($1, 'One too many')`, [ws])));
    expect(msg).toMatch(/Free plan allows up to 25 documents/);
    // Other modules have their own allowance, and existing items stay editable.
    await asUser(db, owner, (tx) => tx.query(`select create_board($1, 'Roadmap')`, [ws]));
    const renamed = await asUser(db, owner, (tx) => tx.query(`update documents set title = 'Doc zero' where workspace_id = $1 and title = 'Doc 0'`, [ws]));
    expect(renamed.affectedRows).toBe(1);

    await setAccountPlan(db, owner, "team");
    await asUser(db, owner, (tx) => tx.query(`insert into documents (workspace_id, title) values ($1, 'Room to grow')`, [ws]));
    expect(await count(db, `select 1 from documents where workspace_id = $1`, [ws])).toBe(26);
  });

  it("refuses items and module switches for tools outside the plan", async () => {
    const { owner, ws } = await customer("Basic");
    const wb = await expectError(asUser(db, owner, (tx) => tx.query(`insert into whiteboards (workspace_id, title) values ($1, 'Sketch')`, [ws])));
    expect(wb).toMatch(/Whiteboard isn't included in the Free plan/);
    const on = await expectError(
      asUser(db, owner, (tx) => tx.query(`update workspace_modules set enabled = true where workspace_id = $1 and module_type = 'code'`, [ws])),
    );
    expect(on).toMatch(/Code isn't included in the Free plan/);
  });

  it("a downgrade keeps existing content readable but makes its rooms read-only", async () => {
    const { owner, ws } = await customer("Downgrade");
    await setPlan(db, ws, "team");
    const wb = await asUser(db, owner, (tx) => tx.query<{ id: string }>(`insert into whiteboards (workspace_id, title) values ($1, 'Kept') returning id`, [ws]));
    const room = `whiteboard:${wb.rows[0]!.id}`;
    await setAccountPlan(db, owner, "free");
    expect(await asUser(db, owner, (tx) => count(tx, `select 1 from whiteboards where workspace_id = $1`, [ws]))).toBe(1);
    const access = await db.query<{ role: string }>(`select role from collab.room_access($1, $2)`, [room, owner.id]);
    expect(access.rows[0]!.role).toBe("viewer");
  });

  it("treats a lapsed trial as Free", async () => {
    const { owner, ws } = await customer("Lapsed");
    await db.query(`update account_subscriptions set plan_id = 'team', status = 'trialing', trial_ends_at = now() - interval '1 day' where user_id = $1`, [
      owner.id,
    ]);
    expect(await expectError(asUser(db, owner, (tx) => tx.query(`insert into mindmaps (workspace_id, title) values ($1, 'Plan')`, [ws])))).toMatch(
      /Free plan/,
    );
  });

  it("enforces the storage quota on attachments, and Custom has none", async () => {
    const { owner, ws } = await customer("Files");
    const path = (n: number) => `${ws}/00000000-0000-4000-8000-00000000000${n}/f${n}.pdf`;
    const add = (n: number, bytes: number) =>
      asUser(db, owner, (tx) =>
        tx.query(`insert into attachments (workspace_id, storage_path, file_name, mime_type, size_bytes) values ($1, $2, 'f.pdf', 'application/pdf', $3)`, [
          ws,
          path(n),
          bytes,
        ]),
      );
    await db.query(`update plans set storage_mb = 1 where id = 'free'`);
    try {
      await add(1, 700_000);
      expect(await expectError(add(2, 400_000))).toMatch(/used its 1 MB of file storage/);
      // The same upload goes through once the account is on Custom.
      await setAccountPlan(db, owner, "custom");
      await add(2, 400_000);
    } finally {
      await db.query(`update plans set storage_mb = 100 where id = 'free'`);
    }
  });
});

describe("upgrades bring tools back", () => {
  it("switches on the tools a plan had switched off, but not ones the owner turned off", async () => {
    const { owner, ws } = await customer("Upgrader");
    // The owner deliberately turns off a Free tool.
    await asUser(db, owner, (tx) => tx.query(`update workspace_modules set enabled = false where workspace_id = $1 and module_type = 'chat'`, [ws]));
    await asUser(db, staff, (tx) => tx.query(`select admin_set_plan($1, 'business')`, [owner.id]));
    expect(await enabledModules(ws)).toEqual(["docs", "whiteboard", "kanban", "mindmap", "code", "playlist", "shopping"]);
  });

  it("a trial does the same", async () => {
    const { owner, ws } = await customer("Trialist");
    await asUser(db, staff, (tx) => tx.query(`select admin_extend_trial($1, 14)`, [owner.id]));
    expect(await enabledModules(ws)).toEqual(ALL);
  });
});

describe("suspended and canceled accounts", () => {
  let owner: TestUser;
  let ws: string;
  let member: TestUser;
  let docId: string;

  beforeAll(async () => {
    ({ owner, ws } = await customer("Paused"));
    member = await createUser(db, "PausedMember");
    await addMember(db, ws, member, "member");
    docId = (await asUser(db, member, (tx) => tx.query<{ id: string }>(`insert into documents (workspace_id, title) values ($1, 'Before') returning id`, [ws]))).rows[0]!.id;
    await asUser(db, staff, (tx) => tx.query(`select admin_set_status($1, 'suspended', 'Chargeback')`, [owner.id]));
  });

  it("make every owned workspace readable but refuse every write with a clear message", async () => {
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

  it("can still delete their workspaces", async () => {
    const { owner: o, ws: doomed } = await customer("Doomed");
    await asUser(db, o, (tx) => tx.query(`insert into documents (workspace_id, title) values ($1, 'x')`, [doomed]));
    await setAccountPlan(db, o, "free", "canceled");
    expect(await expectError(asUser(db, o, (tx) => tx.query(`insert into documents (workspace_id, title) values ($1, 'y')`, [doomed])))).toMatch(
      /canceled, so it's read-only/,
    );
    await asUser(db, o, (tx) => tx.query(`select delete_workspace($1)`, [doomed]));
    expect(await count(db, `select 1 from workspaces where id = $1`, [doomed])).toBe(0);
  });

  it("become writable again when reactivated", async () => {
    await asUser(db, staff, (tx) => tx.query(`select admin_set_status($1, 'active')`, [owner.id]));
    await asUser(db, member, (tx) => tx.query(`insert into documents (workspace_id, title) values ($1, 'After')`, [ws]));
  });
});

describe("admin RPCs", () => {
  const calls: [string, (target: { user: string; ws: string }) => unknown[]][] = [
    [`select * from admin_overview()`, () => []],
    [`select * from admin_list_customers()`, () => []],
    [`select * from admin_get_customer($1)`, (t) => [t.user]],
    [`select * from admin_customer_workspaces($1)`, (t) => [t.user]],
    [`select * from admin_workspace_members($1)`, (t) => [t.ws]],
    [`select * from admin_list_audit_log()`, () => []],
    [`select admin_set_plan($1, 'custom')`, (t) => [t.user]],
    [`select admin_set_status($1, 'suspended')`, (t) => [t.user]],
    [`select admin_extend_trial($1, 14)`, (t) => [t.user]],
    [`select admin_set_notes($1, 'pwned')`, (t) => [t.user]],
    [`select admin_set_custom_price($1, 1)`, (t) => [t.user]],
  ];

  it("are refused for signed-in non-admins, including the customer themselves, and for anon", async () => {
    const { owner, ws } = await customer("Target");
    for (const [sql, params] of calls) {
      expect(await expectError(asUser(db, owner, (tx) => tx.query(sql, params({ user: owner.id, ws }))))).toMatch(/Platform admin access required/);
      await expectError(asUser(db, null, (tx) => tx.query(sql, params({ user: owner.id, ws }))));
    }
    expect(await account(owner)).toMatchObject({ plan_id: "free", status: "active", notes: "", custom_price_cents: null });
    expect(await asUser(db, owner, (tx) => tx.query<{ ok: boolean }>(`select is_platform_admin() as ok`))).toMatchObject({ rows: [{ ok: false }] });
    // The audit log and admin list are not readable directly either.
    expect(await asUser(db, owner, (tx) => count(tx, `select 1 from admin_audit_log`)).catch(() => 0)).toBe(0);
    expect(await asUser(db, owner, (tx) => count(tx, `select 1 from platform_admins`)).catch(() => 0)).toBe(0);
  });

  it("let a platform admin manage a customer, and record every change", async () => {
    const { owner } = await customer("Managed");
    expect(await asUser(db, staff, (tx) => tx.query<{ ok: boolean }>(`select is_platform_admin() as ok`))).toMatchObject({ rows: [{ ok: true }] });

    const ends = await asUser(db, staff, (tx) => tx.query<{ ends: string }>(`select admin_extend_trial($1, 14) as ends`, [owner.id]));
    expect(await account(owner)).toMatchObject({ plan_id: "team", status: "trialing" });
    expect(new Date(ends.rows[0]!.ends).getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);

    await asUser(db, staff, async (tx) => {
      await tx.query(`select admin_set_plan($1, 'custom')`, [owner.id]);
      await tx.query(`select admin_set_custom_price($1, 49900)`, [owner.id]);
      await tx.query(`select admin_set_status($1, 'active')`, [owner.id]);
      await tx.query(`select admin_set_notes($1, 'Annual contract, invoiced')`, [owner.id]);
      // Unchanged values are not logged twice.
      await tx.query(`select admin_set_plan($1, 'custom')`, [owner.id]);
      await tx.query(`select admin_set_custom_price($1, 49900)`, [owner.id]);
    });
    expect(await account(owner)).toMatchObject({
      plan_id: "custom",
      status: "active",
      trial_ends_at: null,
      notes: "Annual contract, invoiced",
      custom_price_cents: 49900,
    });
    expect(await expectError(asUser(db, staff, (tx) => tx.query(`select admin_set_plan($1, 'platinum')`, [owner.id])))).toMatch(/Unknown plan/);
    expect(await expectError(asUser(db, staff, (tx) => tx.query(`select admin_extend_trial($1, 365)`, [owner.id])))).toMatch(/1 to 90 days/);
    expect(await expectError(asUser(db, staff, (tx) => tx.query(`select admin_set_custom_price($1, -1)`, [owner.id])))).toMatch(/between/);

    const log = await asUser(db, staff, (tx) =>
      tx.query<{ action: string; actor_email: string; subject_email: string }>(`select * from admin_list_audit_log($1)`, [owner.id]),
    );
    expect(log.rows.map((r) => r.action).sort()).toEqual(["custom_price_set", "notes_updated", "plan_changed", "status_changed", "trial_extended"]);
    expect(log.rows.every((r) => r.actor_email === staff.email && r.subject_email === owner.email)).toBe(true);
  });

  it("list, search, filter and summarise customers", async () => {
    const { owner, ws } = await customer("Searchable Widgets");
    await asUser(db, owner, (tx) => tx.query(`insert into documents (workspace_id, title) values ($1, 'One')`, [ws]));
    await asUser(db, staff, (tx) => tx.query(`select admin_set_plan($1, 'team')`, [owner.id]));
    const second = await createWorkspace(db, owner, "Widgets Two");

    const found = await asUser(db, staff, (tx) =>
      tx.query<{ user_id: string; email: string; plan_id: string; workspace_count: number; max_workspaces: number; member_count: number; total_count: number }>(
        `select * from admin_list_customers('widgets')`,
      ),
    );
    expect(found.rows).toHaveLength(1);
    expect(found.rows[0]).toMatchObject({ user_id: owner.id, email: owner.email, plan_id: "team", workspace_count: 2, max_workspaces: 3, member_count: 1 });
    // Search by email, filter by plan, and LIKE wildcards are literal.
    expect(await asUser(db, staff, (tx) => count(tx, `select * from admin_list_customers($1)`, [owner.email]))).toBe(1);
    expect(await asUser(db, staff, (tx) => count(tx, `select * from admin_list_customers('', 'team', 'active')`))).toBeGreaterThanOrEqual(1);
    expect(await asUser(db, staff, (tx) => count(tx, `select * from admin_list_customers('%')`))).toBe(0);
    // Accounts that only join other people's workspaces aren't customers, but search finds them.
    const joiner = await createUser(db, "Joiner");
    expect(await asUser(db, staff, (tx) => count(tx, `select * from admin_list_customers() where user_id = $1`, [joiner.id]))).toBe(0);
    expect(await asUser(db, staff, (tx) => count(tx, `select * from admin_list_customers($1)`, [joiner.email]))).toBe(1);

    const detail = await asUser(db, staff, (tx) =>
      tx.query<{ plan_id: string; workspace_count: number; max_workspaces: number; max_members: number }>(`select * from admin_get_customer($1)`, [owner.id]),
    );
    expect(detail.rows[0]).toMatchObject({ plan_id: "team", workspace_count: 2, max_workspaces: 3, max_members: 15 });
    const workspaces = await asUser(db, staff, (tx) =>
      tx.query<{ workspace_id: string; item_count: number; member_count: number }>(`select * from admin_customer_workspaces($1)`, [owner.id]),
    );
    expect(workspaces.rows.map((w) => w.workspace_id)).toEqual([ws, second]);
    expect(workspaces.rows[0]).toMatchObject({ item_count: 2, member_count: 1 });
    expect(await expectError(asUser(db, staff, (tx) => tx.query(`select * from admin_get_customer(gen_random_uuid())`)))).toMatch(/Customer not found/);

    const overview = await asUser(db, staff, (tx) =>
      tx.query<{ total_workspaces: number; mrr_cents: number; by_plan: { plan_id: string; customers: number }[]; by_status: Record<string, number> }>(
        `select * from admin_overview()`,
      ),
    );
    const o = overview.rows[0]!;
    expect(Number(o.total_workspaces)).toBe(await count(db, `select 1 from workspaces`));
    expect(o.by_plan.map((p) => p.plan_id)).toEqual(["free", "team", "business", "custom"]);
    expect(Object.keys(o.by_status).sort()).toEqual(["active", "canceled", "past_due", "suspended", "trialing"]);
    const expectedMrr = await db.query<{ n: number }>(
      `select coalesce(sum(case when p.id = 'custom' then coalesce(a.custom_price_cents, 0) else p.monthly_price_cents end), 0)::int as n
         from account_subscriptions a join plans p on p.id = a.plan_id
        where a.status in ('active','past_due')
          and (a.plan_id <> 'free' or exists (select 1 from workspaces w where w.owner_id = a.user_id))`,
    );
    expect(Number(o.mrr_cents)).toBe(expectedMrr.rows[0]!.n);
  });

  it("logs platform admin grants made in the database", async () => {
    const r = await db.query<{ action: string; details: { email: string } }>(`select action, details from admin_audit_log where action = 'admin_granted'`);
    expect(r.rows.map((x) => x.details.email)).toContain(staff.email);
  });

  it("keep the billing seam closed to clients", async () => {
    const { owner } = await customer("Billing");
    await expectError(asUser(db, owner, (tx) => tx.query(`select billing_apply_provider_update($1, 'business', 'active')`, [owner.id])));
    await expectError(asUser(db, staff, (tx) => tx.query(`select billing_apply_provider_update($1, 'business', 'active')`, [owner.id])));
  });
});

describe("upgrading from per-workspace plans (20261023000009)", () => {
  it("moves each owner onto the best plan any of their workspaces had and restores their tools", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { MIGRATIONS_DIR, migrationFiles, shimSql } = await import("./support/db");
    const old = new PGlite();
    await old.exec(shimSql());
    const files = migrationFiles();
    const split = files.indexOf("20261023000010_account_plans.sql");
    for (const f of files.slice(0, split)) await old.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));

    // Before: one owner with a Free workspace and a Business one (created on
    // Free, so its extra tools were switched off), and a suspended owner.
    const owner = await createUser(old, "Legacy");
    const free = await createWorkspace(old, owner, "Legacy Free");
    const biz = await createWorkspace(old, owner, "Legacy Biz");
    await old.query(`update workspace_subscriptions set plan_id = 'business', notes = 'VIP' where workspace_id = $1`, [biz]);
    const banned = await createUser(old, "Banned");
    const bannedWs = await createWorkspace(old, banned, "Banned Co");
    await old.query(`update workspace_subscriptions set status = 'suspended' where workspace_id = $1`, [bannedWs]);

    for (const f of files.slice(split)) await old.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));

    const accounts = await old.query<{ user_id: string; plan_id: string; status: string; notes: string }>(
      `select user_id, plan_id, status, notes from account_subscriptions where user_id in ($1, $2) order by plan_id`,
      [owner.id, banned.id],
    );
    expect(accounts.rows).toEqual([
      { user_id: owner.id, plan_id: "business", status: "active", notes: "Legacy Biz: VIP" },
      { user_id: banned.id, plan_id: "free", status: "suspended", notes: "" },
    ]);
    // Both of the owner's workspaces now run on Business with every tool on.
    for (const ws of [free, biz]) {
      const r = await old.query<{ n: number }>(`select count(*)::int as n from workspace_modules where workspace_id = $1 and enabled`, [ws]);
      expect(r.rows[0]!.n).toBe(8);
    }
    expect((await old.query(`select to_regclass('public.workspace_subscriptions') as t`)).rows).toEqual([{ t: null }]);
    await old.close();
  });
});
