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
let owner: TestUser, admin: TestUser, member: TestUser, viewer: TestUser, outsider: TestUser;
let ws: string;
let otherWs: string;
let docId: string;
let boardId: string;
let columnId: string;
let taskId: string;
let channelId: string;

beforeAll(async () => {
  db = await createTestDb();
  owner = await createUser(db, "Olivia");
  admin = await createUser(db, "Adam");
  member = await createUser(db, "Mia");
  viewer = await createUser(db, "Victor");
  outsider = await createUser(db, "Mallory");
  ws = await createWorkspace(db, owner, "Acme");
  otherWs = await createWorkspace(db, outsider, "Mallory's place");
  await addMember(db, ws, admin, "admin");
  await addMember(db, ws, member, "member");
  await addMember(db, ws, viewer, "viewer");
  // These tests cover roles and isolation, not plans; plans.test.ts covers Free.
  await setPlan(db, ws, "team");

  await asUser(db, member, async (tx) => {
    docId = (await tx.query<{ id: string }>(`insert into documents (workspace_id, title) values ($1, 'Plan') returning id`, [ws])).rows[0]!.id;
    boardId = (await tx.query<{ id: string }>(`insert into boards (workspace_id, title) values ($1, 'Roadmap') returning id`, [ws])).rows[0]!.id;
    columnId = (await tx.query<{ id: string }>(
      `insert into board_columns (workspace_id, board_id, title, position) values ($1, $2, 'Todo', 'a0') returning id`,
      [ws, boardId],
    )).rows[0]!.id;
    taskId = (await tx.query<{ id: string }>(
      `insert into tasks (workspace_id, board_id, column_id, title, position) values ($1, $2, $3, 'Ship it', 'a0') returning id`,
      [ws, boardId, columnId],
    )).rows[0]!.id;
    channelId = (await tx.query<{ id: string }>(`select id from channels where workspace_id = $1 and name = 'general'`, [ws])).rows[0]!.id;
    await tx.query(`insert into messages (workspace_id, channel_id, body) values ($1, $2, 'hello')`, [ws, channelId]);
  });
});

describe("create_workspace", () => {
  it("creates owner membership, all modules and #general atomically", async () => {
    await asUser(db, owner, async (tx) => {
      expect(await count(tx, `select 1 from workspace_members where workspace_id = $1 and role = 'owner'`, [ws])).toBe(1);
      expect(await count(tx, `select 1 from workspace_modules where workspace_id = $1`, [ws])).toBe(8);
      expect(await count(tx, `select 1 from channels where workspace_id = $1 and name = 'general'`, [ws])).toBe(1);
    });
  });

  it("rolls back entirely when given an unknown module", async () => {
    const before = await count(db, `select 1 from workspaces`);
    const msg = await expectError(
      asUser(db, owner, (tx) => tx.query(`select create_workspace('Bad', '', '✦', 'iris', array['docs','nope'])`)),
    );
    expect(msg).toMatch(/Unknown module/);
    expect(await count(db, `select 1 from workspaces`)).toBe(before);
  });

  it("rejects invalid names and colours (server-side validation)", async () => {
    await expectError(asUser(db, owner, (tx) => tx.query(`select create_workspace('   ')`)));
    await expectError(asUser(db, owner, (tx) => tx.query(`select create_workspace('X', '', '✦', 'neon')`)));
  });

  it("is not callable anonymously", async () => {
    const msg = await expectError(asUser(db, null, (tx) => tx.query(`select create_workspace('Anon')`)));
    expect(msg).toMatch(/permission denied|Not authenticated/);
  });
});

describe("tenant isolation (outsider attacking another workspace directly)", () => {
  const privateTables = [
    "workspaces",
    "workspace_members",
    "workspace_modules",
    "documents",
    "boards",
    "board_columns",
    "tasks",
    "channels",
    "messages",
    "collaboration_rooms",
    "activity_events",
  ];

  for (const table of privateTables) {
    it(`cannot read ${table}`, async () => {
      const col = table === "workspaces" ? "id" : "workspace_id";
      const n = await asUser(db, outsider, (tx) => count(tx, `select 1 from ${table} where ${col} = $1`, [ws]));
      expect(n).toBe(0);
    });
  }

  it("cannot read the victim's profiles", async () => {
    const n = await asUser(db, outsider, (tx) => count(tx, `select 1 from profiles where id = $1`, [owner.id]));
    expect(n).toBe(0);
  });

  it("cannot insert content into the workspace", async () => {
    const msg = await expectError(
      asUser(db, outsider, (tx) => tx.query(`insert into documents (workspace_id, title) values ($1, 'pwned')`, [ws])),
    );
    expect(msg).toMatch(/row-level security/);
  });

  it("cannot update or delete content (affects zero rows)", async () => {
    await asUser(db, outsider, async (tx) => {
      const u = await tx.query(`update documents set title = 'pwned' where id = $1`, [docId]);
      expect(u.affectedRows).toBe(0);
      const d = await tx.query(`delete from tasks where id = $1`, [taskId]);
      expect(d.affectedRows).toBe(0);
    });
    expect((await db.query<{ title: string }>(`select title from documents where id = $1`, [docId])).rows[0]!.title).toBe("Plan");
  });

  it("cannot attach rows in its own workspace to the victim's parents (composite FKs)", async () => {
    let otherBoard = "";
    await asUser(db, outsider, async (tx) => {
      otherBoard = (await tx.query<{ id: string }>(`insert into boards (workspace_id, title) values ($1, 'Mine') returning id`, [otherWs])).rows[0]!.id;
    });
    // Victim's column, attacker's workspace and board.
    const msg = await expectError(
      asUser(db, outsider, (tx) =>
        tx.query(`insert into tasks (workspace_id, board_id, column_id, title, position) values ($1, $2, $3, 'x', 'a0')`, [
          otherWs,
          otherBoard,
          columnId,
        ]),
      ),
    );
    expect(msg).toMatch(/foreign key/);
    // Victim's channel from the attacker's workspace.
    const msg2 = await expectError(
      asUser(db, outsider, (tx) =>
        tx.query(`insert into messages (workspace_id, channel_id, body) values ($1, $2, 'x')`, [otherWs, channelId]),
      ),
    );
    expect(msg2).toMatch(/foreign key/);
  });

  it("cannot join by inserting a membership row", async () => {
    const msg = await expectError(
      asUser(db, outsider, (tx) =>
        tx.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')`, [ws, outsider.id]),
      ),
    );
    expect(msg).toMatch(/row-level security|permission denied/);
  });

  it("cannot call privileged functions on the victim's workspace", async () => {
    await expectError(asUser(db, outsider, (tx) => tx.query(`select delete_workspace($1)`, [ws])));
    await expectError(asUser(db, outsider, (tx) => tx.query(`select create_invitation($1, 'x@y.z', 'admin')`, [ws])));
    await expectError(asUser(db, outsider, (tx) => tx.query(`select update_member_role($1, $2, 'viewer')`, [ws, admin.id])));
    await expectError(asUser(db, outsider, (tx) => tx.query(`select remove_member($1, $2)`, [ws, member.id])));
    await expectError(asUser(db, outsider, (tx) => tx.query(`select workspace_member_list($1)`, [ws])));
  });

  it("anonymous users see nothing", async () => {
    for (const t of ["workspaces", "documents", "tasks", "messages", "profiles"]) {
      expect(await asUser(db, null, (tx) => count(tx, `select 1 from ${t}`))).toBe(0);
    }
  });
});

describe("role matrix", () => {
  it("viewer reads but cannot create, edit or delete shared content", async () => {
    await asUser(db, viewer, async (tx) => {
      expect(await count(tx, `select 1 from documents where workspace_id = $1`, [ws])).toBeGreaterThan(0);
      const u = await tx.query(`update tasks set title = 'viewer edit' where id = $1`, [taskId]);
      expect(u.affectedRows).toBe(0);
      const d = await tx.query(`delete from documents where id = $1`, [docId]);
      expect(d.affectedRows).toBe(0);
    });
    for (const sql of [
      [`insert into documents (workspace_id, title) values ($1, 'v')`, [ws]],
      [`insert into messages (workspace_id, channel_id, body) values ($1, $2, 'v')`, [ws, channelId]],
      [`insert into boards (workspace_id, title) values ($1, 'v')`, [ws]],
      [`insert into playlists (workspace_id, title) values ($1, 'v')`, [ws]],
      [`insert into shopping_lists (workspace_id, title) values ($1, 'v')`, [ws]],
    ] as const) {
      const msg = await expectError(asUser(db, viewer, (tx) => tx.query(sql[0], [...sql[1]])));
      expect(msg).toMatch(/row-level security/);
    }
  });

  it("member edits content but cannot manage modules, settings, invitations or roles", async () => {
    await asUser(db, member, async (tx) => {
      const u = await tx.query(`update tasks set title = 'Ship it now' where id = $1`, [taskId]);
      expect(u.affectedRows).toBe(1);
      const m = await tx.query(`update workspace_modules set enabled = false where workspace_id = $1`, [ws]);
      expect(m.affectedRows).toBe(0);
      const w = await tx.query(`update workspaces set name = 'Hijacked' where id = $1`, [ws]);
      expect(w.affectedRows).toBe(0);
      expect(await count(tx, `select 1 from invitations where workspace_id = $1`, [ws])).toBe(0);
    });
    await expectError(asUser(db, member, (tx) => tx.query(`select create_invitation($1, 'n@x.io', 'member')`, [ws])));
    await expectError(asUser(db, member, (tx) => tx.query(`select update_member_role($1, $2, 'admin')`, [ws, member.id])));
    await expectError(asUser(db, member, (tx) => tx.query(`select remove_member($1, $2)`, [ws, viewer.id])));
  });

  it("admin manages modules and members but cannot delete, transfer or touch the owner", async () => {
    await asUser(db, admin, async (tx) => {
      const m = await tx.query(`update workspace_modules set enabled = false where workspace_id = $1 and module_type = 'code'`, [ws]);
      expect(m.affectedRows).toBe(1);
      await tx.query(`update workspace_modules set enabled = true where workspace_id = $1 and module_type = 'code'`, [ws]);
      await tx.query(`select update_member_role($1, $2, 'member')`, [ws, viewer.id]);
      await tx.query(`select update_member_role($1, $2, 'viewer')`, [ws, viewer.id]);
    });
    expect(await expectError(asUser(db, admin, (tx) => tx.query(`select delete_workspace($1)`, [ws])))).toMatch(/Only the owner/);
    expect(await expectError(asUser(db, admin, (tx) => tx.query(`select transfer_ownership($1, $2)`, [ws, admin.id])))).toMatch(/Only the owner/);
    expect(await expectError(asUser(db, admin, (tx) => tx.query(`select update_member_role($1, $2, 'viewer')`, [ws, owner.id])))).toMatch(/owner/);
    expect(await expectError(asUser(db, admin, (tx) => tx.query(`select remove_member($1, $2)`, [ws, owner.id])))).toMatch(/owner cannot be removed/);
    expect(await expectError(asUser(db, admin, (tx) => tx.query(`select update_member_role($1, $2, 'owner')`, [ws, member.id])))).toMatch(/Invalid role/);
  });

  it("rejects invalid role values", async () => {
    const msg = await expectError(asUser(db, owner, (tx) => tx.query(`select update_member_role($1, $2, 'superuser')`, [ws, member.id])));
    expect(msg).toMatch(/Invalid role/);
  });

  it("member list hides emails from non-managers", async () => {
    const asMember = await asUser(db, member, (tx) =>
      tx.query<{ user_id: string; email: string | null }>(`select * from workspace_member_list($1)`, [ws]),
    );
    expect(asMember.rows.find((r) => r.user_id === owner.id)!.email).toBeNull();
    expect(asMember.rows.find((r) => r.user_id === member.id)!.email).toBe(member.email);
    const asAdmin = await asUser(db, admin, (tx) =>
      tx.query<{ user_id: string; email: string | null }>(`select * from workspace_member_list($1)`, [ws]),
    );
    expect(asAdmin.rows.find((r) => r.user_id === owner.id)!.email).toBe(owner.email);
  });
});

describe("ownership", () => {
  it("owner can transfer ownership and the invariant of one owner holds", async () => {
    const tmpOwner = await createUser(db, "Tara");
    const tmpAdmin = await createUser(db, "Theo");
    const tws = await createWorkspace(db, tmpOwner, "Temp");
    await addMember(db, tws, tmpAdmin, "member");
    await asUser(db, tmpOwner, (tx) => tx.query(`select transfer_ownership($1, $2)`, [tws, tmpAdmin.id]));
    const roles = await db.query<{ user_id: string; role: string }>(`select user_id, role from workspace_members where workspace_id = $1`, [tws]);
    expect(Object.fromEntries(roles.rows.map((r) => [r.user_id, r.role]))).toEqual({ [tmpOwner.id]: "admin", [tmpAdmin.id]: "owner" });
    expect((await db.query<{ owner_id: string }>(`select owner_id from workspaces where id = $1`, [tws])).rows[0]!.owner_id).toBe(tmpAdmin.id);
    // The former owner can no longer delete it; the new owner can.
    await expectError(asUser(db, tmpOwner, (tx) => tx.query(`select delete_workspace($1)`, [tws])));
    await asUser(db, tmpAdmin, (tx) => tx.query(`select delete_workspace($1)`, [tws]));
    expect(await count(db, `select 1 from workspaces where id = $1`, [tws])).toBe(0);
    expect(await count(db, `select 1 from channels where workspace_id = $1`, [tws])).toBe(0);
  });

  it("cannot transfer to a non-member", async () => {
    const msg = await expectError(asUser(db, owner, (tx) => tx.query(`select transfer_ownership($1, $2)`, [ws, outsider.id])));
    expect(msg).toMatch(/must already be a member/);
  });
});

describe("integrity guards", () => {
  it("forces created_by to the caller", async () => {
    const r = await asUser(db, member, (tx) =>
      tx.query<{ created_by: string }>(`insert into documents (workspace_id, title, created_by) values ($1, 'Forged', $2) returning created_by`, [ws, owner.id]),
    );
    expect(r.rows[0]!.created_by).toBe(member.id);
  });

  it("does not allow moving rows to another workspace", async () => {
    await addMember(db, otherWs, member, "member");
    const msg = await expectError(asUser(db, member, (tx) => tx.query(`update documents set workspace_id = $1 where id = $2`, [otherWs, docId])));
    expect(msg).toMatch(/immutable/);
    await db.query(`delete from workspace_members where workspace_id = $1 and user_id = $2`, [otherWs, member.id]);
  });

  it("rejects assignees who are not members", async () => {
    const msg = await expectError(asUser(db, member, (tx) => tx.query(`update tasks set assignee_id = $1 where id = $2`, [outsider.id, taskId])));
    expect(msg).toMatch(/Assignee must be a workspace member/);
  });

  it("bumps task versions for optimistic concurrency", async () => {
    await asUser(db, member, async (tx) => {
      const v = (await tx.query<{ version: number }>(`select version from tasks where id = $1`, [taskId])).rows[0]!.version;
      const ok = await tx.query(`update tasks set title = 'v-check' where id = $1 and version = $2`, [taskId, v]);
      expect(ok.affectedRows).toBe(1);
      const stale = await tx.query(`update tasks set title = 'stale' where id = $1 and version = $2`, [taskId, v]);
      expect(stale.affectedRows).toBe(0);
    });
  });

  it("rejects invalid payloads via CHECK constraints", async () => {
    const bad: [string, unknown[]][] = [
      [`update tasks set priority = 'critical' where id = $1`, [taskId]],
      [`update tasks set title = '' where id = $1`, [taskId]],
      [`update tasks set position = 'a b' where id = $1`, [taskId]],
      [`update tasks set labels = array['${"x".repeat(30)}'] where id = $1`, [taskId]],
      [`insert into documents (workspace_id, title) values ($1, repeat('x', 121))`, [ws]],
      [`insert into messages (workspace_id, channel_id, body) values ($1, $2, '   ')`, [ws, channelId]],
      [`insert into channels (workspace_id, name) values ($1, 'Bad Name!')`, [ws]],
    ];
    for (const [sql, params] of bad) {
      await expectError(asUser(db, member, (tx) => tx.query(sql, params)));
    }
  });
});

describe("membership revocation", () => {
  it("a removed member immediately loses read and write access", async () => {
    const temp = await createUser(db, "Rita");
    await addMember(db, ws, temp, "member");
    expect(await asUser(db, temp, (tx) => count(tx, `select 1 from documents where workspace_id = $1`, [ws]))).toBeGreaterThan(0);
    await asUser(db, admin, (tx) => tx.query(`select remove_member($1, $2)`, [ws, temp.id]));
    expect(await asUser(db, temp, (tx) => count(tx, `select 1 from documents where workspace_id = $1`, [ws]))).toBe(0);
    await expectError(asUser(db, temp, (tx) => tx.query(`insert into documents (workspace_id, title) values ($1, 'after')`, [ws])));
    const u = await asUser(db, temp, (tx) => tx.query(`update tasks set title = 'after' where id = $1`, [taskId]));
    expect(u.affectedRows).toBe(0);
  });

  it("a member can leave, but the owner cannot", async () => {
    const temp = await createUser(db, "Leo");
    await addMember(db, ws, temp, "viewer");
    await asUser(db, temp, (tx) => tx.query(`select remove_member($1, $2)`, [ws, temp.id]));
    expect(await count(db, `select 1 from workspace_members where workspace_id = $1 and user_id = $2`, [ws, temp.id])).toBe(0);
    await expectError(asUser(db, owner, (tx) => tx.query(`select remove_member($1, $2)`, [ws, owner.id])));
  });
});
