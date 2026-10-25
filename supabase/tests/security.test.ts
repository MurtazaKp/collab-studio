import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addMember, asUser, count, createTestDb, createUser as createAccount, createWorkspace, expectError, setAccountPlan, type TestUser } from "./support/db";

// Holes found by the 2026-10-24 break test, fixed in 20261024000011.
let db: PGlite;

/**
 * New accounts start on a 14-day Team trial (20261024000014). These tests
 * exercise the Free plan's limits, so their accounts start on Free.
 */
async function createUser(database: PGlite, name: string): Promise<TestUser> {
  const user = await createAccount(database, name);
  await setAccountPlan(database, user, "free");
  return user;
}
let staff: TestUser;

async function ownerOf(ws: string): Promise<string> {
  return (await db.query<{ owner_id: string }>(`select owner_id from workspaces where id = $1`, [ws])).rows[0]!.owner_id;
}

beforeAll(async () => {
  db = await createTestDb();
  staff = await createUser(db, "Staff");
  await db.query(`insert into platform_admins (user_id) values ($1)`, [staff.id]);
});

describe("workspace ownership", () => {
  it("a workspace admin can't make themselves owner", async () => {
    const owner = await createUser(db, "Owner");
    const admin = await createUser(db, "Admin");
    const ws = await createWorkspace(db, owner, "Target");
    await addMember(db, ws, admin, "admin");
    expect(await expectError(asUser(db, admin, (tx) => tx.query(`update workspaces set owner_id = $1 where id = $2`, [admin.id, ws])))).toMatch(
      /permission denied/,
    );
    expect(await ownerOf(ws)).toBe(owner.id);
    // Editing what admins are meant to edit still works.
    await asUser(db, admin, (tx) => tx.query(`update workspaces set name = 'Renamed', icon = '◆' where id = $1`, [ws]));
  });

  it("an owner can't hand a workspace to a stranger, only transfer it to a member", async () => {
    const owner = await createUser(db, "Owner2");
    const stranger = await createUser(db, "Stranger");
    const ws = await createWorkspace(db, owner, "Dump");
    await expectError(asUser(db, owner, (tx) => tx.query(`update workspaces set owner_id = $1 where id = $2`, [stranger.id, ws])));
    expect(await expectError(asUser(db, owner, (tx) => tx.query(`select transfer_ownership($1, $2)`, [ws, stranger.id])))).toMatch(/must already be a member/);
    expect(await ownerOf(ws)).toBe(owner.id);
  });

  it("platform admins can transfer a workspace to any account, and it's audited", async () => {
    const owner = await createUser(db, "Leaver");
    const heir = await createUser(db, "Heir");
    const outsider = await createUser(db, "Outsider");
    const ws = await createWorkspace(db, owner, "Handover");
    expect(
      await expectError(asUser(db, outsider, (tx) => tx.query(`select admin_transfer_workspace($1, $2)`, [ws, outsider.id]))),
    ).toMatch(/Platform admin access required/);

    await asUser(db, staff, (tx) => tx.query(`select admin_transfer_workspace($1, $2, 'Owner left the company')`, [ws, heir.id]));
    expect(await ownerOf(ws)).toBe(heir.id);
    const roles = await db.query<{ user_id: string; role: string }>(`select user_id, role from workspace_members where workspace_id = $1 order by role`, [ws]);
    expect(roles.rows).toEqual([
      { user_id: owner.id, role: "admin" },
      { user_id: heir.id, role: "owner" },
    ]);
    const log = await asUser(db, staff, (tx) => tx.query<{ action: string; details: { reason: string } }>(`select * from admin_list_audit_log($1)`, [heir.id]));
    expect(log.rows[0]).toMatchObject({ action: "ownership_transferred", details: { reason: "Owner left the company" } });
  });

  it("an admin transfer still respects the new owner's workspace allowance", async () => {
    const owner = await createUser(db, "Giver");
    const full = await createUser(db, "Full");
    const ws = await createWorkspace(db, owner, "Gift");
    await createWorkspace(db, full, "Full's own");
    expect(await expectError(asUser(db, staff, (tx) => tx.query(`select admin_transfer_workspace($1, $2)`, [ws, full.id])))).toMatch(
      /new owner's Free plan allows up to 1 workspace/,
    );
  });
});

describe("storage uploads", () => {
  const upload = (as: TestUser, ws: string, file: string, bytes = 1000) =>
    asUser(db, as, (tx) =>
      tx.query(`insert into storage.objects (bucket_id, name, owner_id, metadata) values ('attachments', $1, $2, jsonb_build_object('size', $3::bigint))`, [
        `${ws}/${file}`,
        as.id,
        bytes,
      ]),
    );

  it("are refused while the account is suspended", async () => {
    const owner = await createUser(db, "Uploader");
    const ws = await createWorkspace(db, owner, "Files");
    await upload(owner, ws, "a/ok.pdf");
    await setAccountPlan(db, owner, "free", "suspended");
    await expectError(upload(owner, ws, "b/blocked.pdf"));
    expect(await count(db, `select 1 from storage.objects where name like $1`, [`${ws}/%`])).toBe(1);
  });

  it("count files with no attachments row toward the quota", async () => {
    const owner = await createUser(db, "Hoarder");
    const ws = await createWorkspace(db, owner, "Hoard");
    await db.query(`update plans set storage_mb = 1 where id = 'free'`);
    try {
      await upload(owner, ws, "a/one.bin", 700_000);
      await upload(owner, ws, "b/two.bin", 400_000); // goes over, as one upload may
      await expectError(upload(owner, ws, "c/three.bin", 1000));
      await setAccountPlan(db, owner, "custom");
      await upload(owner, ws, "c/three.bin", 1000);
    } finally {
      await db.query(`update plans set storage_mb = 100 where id = 'free'`);
    }
  });

  it("are refused for viewers and outsiders", async () => {
    const owner = await createUser(db, "Host");
    const viewer = await createUser(db, "Watcher");
    const outsider = await createUser(db, "Nobody");
    const ws = await createWorkspace(db, owner, "Guarded");
    await addMember(db, ws, viewer, "viewer");
    await expectError(upload(viewer, ws, "v/x.pdf"));
    await expectError(upload(outsider, ws, "o/x.pdf"));
  });
});

describe("invitation rate limit", () => {
  it("allows 30 invitations an hour per person, then refuses", async () => {
    const owner = await createUser(db, "Inviter");
    const ws = await createWorkspace(db, owner, "Busy");
    await setAccountPlan(db, owner, "custom");
    await asUser(db, owner, async (tx) => {
      for (let i = 0; i < 30; i++) await tx.query(`select * from create_invitation($1, $2, 'member')`, [ws, `p${i}@example.test`]);
    });
    const err = await asUser(db, owner, (tx) => tx.query(`select * from create_invitation($1, 'one-more@example.test', 'member')`, [ws])).catch(
      (e: { hint?: string; message: string }) => e,
    );
    expect(err).toMatchObject({ hint: "rate_limited" });
  });
});

describe("what members can see", () => {
  let owner: TestUser;
  let admin: TestUser;
  let member: TestUser;
  let ws: string;

  beforeAll(async () => {
    owner = await createUser(db, "Boss");
    admin = await createUser(db, "Deputy");
    member = await createUser(db, "Staffer");
    ws = await createWorkspace(db, owner, "Office"); // Free: four tools on, four off
    await addMember(db, ws, admin, "admin");
    await addMember(db, ws, member, "member");
  });

  it("owners and admins see the plan; members and viewers get only the write state", async () => {
    for (const who of [owner, admin]) {
      const r = await asUser(db, who, (tx) => tx.query<{ plan_id: string }>(`select * from workspace_usage($1)`, [ws]));
      expect(r.rows[0]!.plan_id).toBe("free");
    }
    expect(await expectError(asUser(db, member, (tx) => tx.query(`select * from workspace_usage($1)`, [ws])))).toMatch(
      /Only owners and admins can see the plan/,
    );
    const state = await asUser(db, member, (tx) => tx.query(`select * from workspace_write_state($1)`, [ws]));
    expect(state.rows).toEqual([{ writable: true, status: "active" }]);
    expect(Object.keys(state.fields.reduce((o, f) => ({ ...o, [f.name]: 1 }), {}))).toEqual(["writable", "status"]);
  });

  it("members see only the modules that are switched on", async () => {
    const seen = (who: TestUser) => asUser(db, who, (tx) => count(tx, `select 1 from workspace_modules where workspace_id = $1`, [ws]));
    expect(await seen(owner)).toBe(11);
    expect(await seen(admin)).toBe(11);
    expect(await seen(member)).toBe(4);
  });
});
