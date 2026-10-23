import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addMember, asUser, count, createTestDb, createUser, createWorkspace, expectError, type TestUser } from "./support/db";

let db: PGlite;
let owner: TestUser, member: TestUser, viewer: TestUser;
let ws: string;

beforeAll(async () => {
  db = await createTestDb();
  owner = await createUser(db, "Owner");
  member = await createUser(db, "Member");
  viewer = await createUser(db, "Viewer");
  ws = await createWorkspace(db, owner);
  await addMember(db, ws, member, "member");
  await addMember(db, ws, viewer, "viewer");
});

describe("create_board", () => {
  it("creates a board with default columns atomically", async () => {
    const r = await asUser(db, member, (tx) => tx.query<{ id: string }>(`select create_board($1, 'Sprint') as id`, [ws]));
    const board = r.rows[0]!.id;
    expect(await count(db, `select 1 from board_columns where board_id = $1`, [board])).toBe(3);
  });

  it("is denied for viewers and leaves nothing behind", async () => {
    const before = await count(db, `select 1 from boards`);
    await expectError(asUser(db, viewer, (tx) => tx.query(`select create_board($1, 'Nope')`, [ws])));
    expect(await count(db, `select 1 from boards`)).toBe(before);
  });
});

describe("move_task", () => {
  it("moves with the expected version and rejects stale concurrent moves", async () => {
    const { board, cols, task } = await asUser(db, member, async (tx) => {
      const board = (await tx.query<{ id: string }>(`select create_board($1, 'Moves') as id`, [ws])).rows[0]!.id;
      const cols = (await tx.query<{ id: string }>(`select id from board_columns where board_id = $1 order by position`, [board])).rows.map((r) => r.id);
      const task = (await tx.query<{ id: string; version: number }>(
        `insert into tasks (workspace_id, board_id, column_id, title, position) values ($1, $2, $3, 'T', 'a0') returning id, version`,
        [ws, board, cols[0]],
      )).rows[0]!;
      return { board, cols, task };
    });
    expect(board).toBeTruthy();
    // Two users read version 1 and both try to move.
    const first = await asUser(db, member, (tx) =>
      tx.query<{ column_id: string; version: number }>(`select column_id, version from move_task($1, $2, 'a1', $3)`, [task.id, cols[1], task.version]),
    );
    expect(first.rows[0]).toEqual({ column_id: cols[1], version: 2 });
    const msg = await expectError(asUser(db, owner, (tx) => tx.query(`select move_task($1, $2, 'a2', $3)`, [task.id, cols[2], task.version])));
    expect(msg).toMatch(/changed by someone else/);
    // Moving into another board's column is rejected by the composite FK.
    const other = await asUser(db, member, (tx) => tx.query<{ id: string }>(`select create_board($1, 'Other') as id`, [ws]));
    const otherCol = (await db.query<{ id: string }>(`select id from board_columns where board_id = $1 limit 1`, [other.rows[0]!.id])).rows[0]!.id;
    expect(await expectError(asUser(db, member, (tx) => tx.query(`select move_task($1, $2, 'a0', 2)`, [task.id, otherCol])))).toMatch(/foreign key/);
    // Viewers cannot move tasks at all.
    expect(await expectError(asUser(db, viewer, (tx) => tx.query(`select move_task($1, $2, 'a0', 2)`, [task.id, cols[0]])))).toMatch(/permission/);
  });

  it("records moves in the activity feed", async () => {
    expect(await count(db, `select 1 from activity_events where workspace_id = $1 and verb = 'moved'`, [ws])).toBeGreaterThan(0);
  });
});
