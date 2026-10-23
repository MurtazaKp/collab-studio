import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, count, createTestDb, createUser, createWorkspace, expectError, type TestUser } from "./support/db";

let db: PGlite;
let owner: TestUser;
let ws: string;

async function invite(email: string, role = "member", as: TestUser = owner, hours = 168) {
  return asUser(db, as, async (tx) => {
    const r = await tx.query<{ invitation_id: string; token: string }>(
      `select * from create_invitation($1, $2, $3, $4)`,
      [ws, email, role, hours],
    );
    return r.rows[0]!;
  });
}

beforeAll(async () => {
  db = await createTestDb();
  owner = await createUser(db, "Owner");
  ws = await createWorkspace(db, owner, "Invite Co");
});

describe("invitations", () => {
  it("stores only a hash of the token, never the token", async () => {
    const inv = await invite("hash@example.test");
    expect(inv.token).toMatch(/^[0-9a-f]{64}$/);
    const row = await db.query<{ token_hash: string }>(`select token_hash from invitations where id = $1`, [inv.invitation_id]);
    expect(row.rows[0]!.token_hash).not.toBe(inv.token);
    expect(row.rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await count(db, `select 1 from invitations where token_hash = $1`, [inv.token])).toBe(0);
  });

  it("accepts for the intended, verified recipient with the invited role, exactly once", async () => {
    const bob = await createUser(db, "Bob");
    const inv = await invite(bob.email, "viewer");
    const preview = await asUser(db, bob, (tx) => tx.query<{ status: string; email_matches: boolean; workspace_name: string }>(`select * from get_invitation_preview($1)`, [inv.token]));
    expect(preview.rows[0]).toMatchObject({ status: "pending", email_matches: true, workspace_name: "Invite Co" });

    const joined = await asUser(db, bob, (tx) => tx.query<{ ws: string }>(`select accept_invitation($1) as ws`, [inv.token]));
    expect(joined.rows[0]!.ws).toBe(ws);
    const role = await db.query<{ role: string }>(`select role from workspace_members where workspace_id = $1 and user_id = $2`, [ws, bob.id]);
    expect(role.rows[0]!.role).toBe("viewer");

    expect(await expectError(asUser(db, bob, (tx) => tx.query(`select accept_invitation($1)`, [inv.token])))).toMatch(/already used/);
  });

  it("rejects a different signed-in user holding the link", async () => {
    const intended = await createUser(db, "Intended");
    const thief = await createUser(db, "Thief");
    const inv = await invite(intended.email);
    const msg = await expectError(asUser(db, thief, (tx) => tx.query(`select accept_invitation($1)`, [inv.token])));
    expect(msg).toMatch(/different email/);
    expect(await count(db, `select 1 from workspace_members where workspace_id = $1 and user_id = $2`, [ws, thief.id])).toBe(0);
  });

  it("rejects unverified email addresses", async () => {
    const unverified = await createUser(db, "Unverified", { confirmed: false });
    const inv = await invite(unverified.email);
    expect(await expectError(asUser(db, unverified, (tx) => tx.query(`select accept_invitation($1)`, [inv.token])))).toMatch(/Verify your email/);
  });

  it("rejects expired invitations", async () => {
    const late = await createUser(db, "Late");
    const inv = await invite(late.email, "member", owner, 1);
    await db.query(`update invitations set created_at = now() - interval '3 hours', expires_at = now() - interval '1 hour' where id = $1`, [inv.invitation_id]);
    expect(await expectError(asUser(db, late, (tx) => tx.query(`select accept_invitation($1)`, [inv.token])))).toMatch(/expired/);
    const p = await asUser(db, late, (tx) => tx.query<{ status: string }>(`select status from get_invitation_preview($1)`, [inv.token]));
    expect(p.rows[0]!.status).toBe("expired");
  });

  it("rejects revoked invitations, and re-inviting revokes the old link", async () => {
    const carol = await createUser(db, "Carol");
    const first = await invite(carol.email);
    const second = await invite(carol.email, "admin");
    expect(await expectError(asUser(db, carol, (tx) => tx.query(`select accept_invitation($1)`, [first.token])))).toMatch(/revoked/);
    await asUser(db, owner, (tx) => tx.query(`select revoke_invitation($1)`, [second.invitation_id]));
    expect(await expectError(asUser(db, carol, (tx) => tx.query(`select accept_invitation($1)`, [second.token])))).toMatch(/revoked/);
  });

  it("returns nothing for malformed or unknown tokens", async () => {
    const someone = await createUser(db, "Someone");
    for (const token of ["", "abc", "z".repeat(64), "0".repeat(64)]) {
      const p = await asUser(db, someone, (tx) => count(tx, `select * from get_invitation_preview($1)`, [token]));
      expect(p).toBe(0);
      await expectError(asUser(db, someone, (tx) => tx.query(`select accept_invitation($1)`, [token])));
    }
  });

  it("does not allow inviting with owner or unknown roles, or excessive expiry", async () => {
    expect(await expectError(invite("r1@example.test", "owner"))).toMatch(/Invalid role/);
    expect(await expectError(invite("r2@example.test", "god"))).toMatch(/Invalid role/);
    expect(await expectError(invite("r3@example.test", "member", owner, 10_000))).toMatch(/Invalid expiry/);
  });

  it("does not invite existing members", async () => {
    expect(await expectError(invite(owner.email))).toMatch(/already a member/);
  });

  it("lists pending invitations for the recipient, who can accept or decline in-app", async () => {
    const dana = await createUser(db, "Dana");
    const inv = await invite(dana.email, "member");
    const pending = await asUser(db, dana, (tx) => tx.query<{ id: string; workspace_name: string }>(`select * from my_pending_invitations()`));
    expect(pending.rows.map((r) => r.id)).toEqual([inv.invitation_id]);
    // The recipient got an in-app notification without the token in it.
    const notes = await asUser(db, dana, (tx) => tx.query<{ link: string; kind: string }>(`select link, kind from notifications`));
    expect(notes.rows).toEqual([{ link: "/invitations", kind: "invitation" }]);

    // Someone else cannot accept it by id.
    const eve = await createUser(db, "Eve");
    expect(await expectError(asUser(db, eve, (tx) => tx.query(`select accept_invitation_by_id($1)`, [inv.invitation_id])))).toMatch(/different email/);
    await asUser(db, dana, (tx) => tx.query(`select accept_invitation_by_id($1)`, [inv.invitation_id]));
    expect(await count(db, `select 1 from workspace_members where workspace_id = $1 and user_id = $2`, [ws, dana.id])).toBe(1);
  });

  it("only managers can read the invitations table", async () => {
    const m = await createUser(db, "Plain");
    await db.query(`insert into workspace_members values ($1, $2, 'member')`, [ws, m.id]);
    expect(await asUser(db, m, (tx) => count(tx, `select 1 from invitations`))).toBe(0);
    expect(await asUser(db, owner, (tx) => count(tx, `select 1 from invitations`))).toBeGreaterThan(0);
  });

  it("clients cannot insert invitations directly (bypassing hashing and checks)", async () => {
    const msg = await expectError(
      asUser(db, owner, (tx) =>
        tx.query(`insert into invitations (workspace_id, email, role, token_hash, expires_at) values ($1, 'x@y.z', 'admin', repeat('a', 64), now() + interval '1 day')`, [ws]),
      ),
    );
    expect(msg).toMatch(/row-level security/);
  });
});
