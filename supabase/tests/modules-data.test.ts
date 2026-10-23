import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  addMember,
  asCollabServer,
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
let owner: TestUser, member: TestUser, viewer: TestUser, outsider: TestUser;
let ws: string;
let channelId: string;

beforeAll(async () => {
  db = await createTestDb();
  owner = await createUser(db, "Owner");
  member = await createUser(db, "Member");
  viewer = await createUser(db, "Viewer");
  outsider = await createUser(db, "Outsider");
  ws = await createWorkspace(db, owner, "Data Co");
  await createWorkspace(db, outsider, "Elsewhere");
  await addMember(db, ws, member, "member");
  await addMember(db, ws, viewer, "viewer");
  // Playlists are outside Free; plans.test.ts covers the Free limits.
  await setPlan(db, ws, "team");
  channelId = (await db.query<{ id: string }>(`select id from channels where workspace_id = $1`, [ws])).rows[0]!.id;
});

describe("chat", () => {
  it("forces authorship, keeps threads one level deep and counts replies", async () => {
    const parent = await asUser(db, member, (tx) =>
      tx.query<{ id: string; author_id: string }>(
        `insert into messages (workspace_id, channel_id, body, author_id) values ($1, $2, 'root', $3) returning id, author_id`,
        [ws, channelId, owner.id],
      ),
    );
    expect(parent.rows[0]!.author_id).toBe(member.id);
    const pid = parent.rows[0]!.id;
    const reply = await asUser(db, owner, (tx) =>
      tx.query<{ id: string }>(`insert into messages (workspace_id, channel_id, body, parent_id) values ($1, $2, 'reply', $3) returning id`, [ws, channelId, pid]),
    );
    const rc = await db.query<{ reply_count: number }>(`select reply_count from messages where id = $1`, [pid]);
    expect(rc.rows[0]!.reply_count).toBe(1);
    expect(
      await expectError(
        asUser(db, owner, (tx) => tx.query(`insert into messages (workspace_id, channel_id, body, parent_id) values ($1, $2, 'deep', $3)`, [ws, channelId, reply.rows[0]!.id])),
      ),
    ).toMatch(/one level/);
    // The parent author was notified of the reply.
    const n = await asUser(db, member, (tx) => tx.query<{ kind: string }>(`select kind from notifications where kind = 'thread_reply'`));
    expect(n.rows.length).toBe(1);
  });

  it("lets only the author edit; edits are timestamped; metadata is immutable", async () => {
    const m = await asUser(db, member, (tx) =>
      tx.query<{ id: string }>(`insert into messages (workspace_id, channel_id, body) values ($1, $2, 'mine') returning id`, [ws, channelId]),
    );
    const id = m.rows[0]!.id;
    const other = await asUser(db, owner, (tx) => tx.query(`update messages set body = 'not yours' where id = $1`, [id]));
    expect(other.affectedRows).toBe(0);
    const mine = await asUser(db, member, (tx) => tx.query<{ edited_at: string | null }>(`update messages set body = 'edited' where id = $1 returning edited_at`, [id]));
    expect(mine.rows[0]!.edited_at).not.toBeNull();
    expect(await expectError(asUser(db, member, (tx) => tx.query(`update messages set author_id = $2 where id = $1`, [id, owner.id])))).toMatch(/immutable|row-level/);
  });

  it("computes unread counts per user and clears them on read", async () => {
    await asUser(db, owner, (tx) => tx.query(`insert into messages (workspace_id, channel_id, body) values ($1, $2, 'news')`, [ws, channelId]));
    const before = await asUser(db, viewer, (tx) => tx.query<{ unread: number }>(`select unread::int from channel_unread_counts($1) where channel_id = $2`, [ws, channelId]));
    expect(before.rows[0]!.unread).toBeGreaterThan(0);
    await asUser(db, viewer, (tx) => tx.query(`select mark_channel_read($1)`, [channelId]));
    const after = await asUser(db, viewer, (tx) => tx.query<{ unread: number }>(`select unread::int from channel_unread_counts($1) where channel_id = $2`, [ws, channelId]));
    expect(after.rows[0]!.unread).toBe(0);
  });

  it("reactions are per-user, validated, and viewers cannot react", async () => {
    const m = (await db.query<{ id: string }>(`select id from messages where workspace_id = $1 limit 1`, [ws])).rows[0]!.id;
    await asUser(db, member, (tx) => tx.query(`insert into message_reactions (message_id, workspace_id, emoji, user_id) values ($1, $2, '👍', $3)`, [m, ws, owner.id]));
    expect(await count(db, `select 1 from message_reactions where user_id = $1`, [member.id])).toBe(1);
    await expectError(asUser(db, member, (tx) => tx.query(`insert into message_reactions (message_id, workspace_id, emoji) values ($1, $2, '💩')`, [m, ws])));
    await expectError(asUser(db, viewer, (tx) => tx.query(`insert into message_reactions (message_id, workspace_id, emoji) values ($1, $2, '👍')`, [m, ws])));
  });
});

describe("playlists and shopping", () => {
  it("only accepts http(s) URLs for playlist items", async () => {
    const pl = await asUser(db, member, (tx) => tx.query<{ id: string }>(`insert into playlists (workspace_id, title) values ($1, 'Focus') returning id`, [ws]));
    const id = pl.rows[0]!.id;
    await asUser(db, member, (tx) =>
      tx.query(`insert into playlist_items (workspace_id, playlist_id, title, url, position) values ($1, $2, 'Song', 'https://example.com/a', 'a0')`, [ws, id]),
    );
    for (const url of ["javascript:alert(1)", "data:text/html,hi", "ftp://x.y", "https://exa mple.com"]) {
      await expectError(
        asUser(db, member, (tx) => tx.query(`insert into playlist_items (workspace_id, playlist_id, title, url, position) values ($1, $2, 'x', $3, 'a1')`, [ws, id, url])),
      );
    }
  });

  it("records who checked a shopping item, server-side", async () => {
    const list = await asUser(db, member, (tx) => tx.query<{ id: string }>(`insert into shopping_lists (workspace_id, title) values ($1, 'Groceries') returning id`, [ws]));
    const lid = list.rows[0]!.id;
    const item = await asUser(db, member, (tx) =>
      tx.query<{ id: string }>(`insert into shopping_items (workspace_id, list_id, name, position, checked_by) values ($1, $2, 'Milk', 'a0', $3) returning id`, [ws, lid, owner.id]),
    );
    const iid = item.rows[0]!.id;
    expect((await db.query<{ checked_by: string | null }>(`select checked_by from shopping_items where id = $1`, [iid])).rows[0]!.checked_by).toBeNull();
    await asUser(db, owner, (tx) => tx.query(`update shopping_items set checked = true, checked_by = $2 where id = $1`, [iid, member.id]));
    const r = await db.query<{ checked_by: string; checked_at: string; version: number }>(`select checked_by, checked_at, version from shopping_items where id = $1`, [iid]);
    expect(r.rows[0]!.checked_by).toBe(owner.id);
    expect(r.rows[0]!.checked_at).not.toBeNull();
    expect(r.rows[0]!.version).toBe(2);
    await expectError(asUser(db, member, (tx) => tx.query(`update shopping_items set quantity = 0 where id = $1`, [iid])));
  });
});

describe("activity and notifications", () => {
  it("are written by triggers and cannot be forged by clients", async () => {
    expect(await count(db, `select 1 from activity_events where workspace_id = $1 and verb = 'joined'`, [ws])).toBe(2);
    await expectError(
      asUser(db, member, (tx) => tx.query(`insert into activity_events (workspace_id, verb, entity_type, title) values ($1, 'created', 'document', 'fake')`, [ws])),
    );
    await expectError(
      asUser(db, member, (tx) => tx.query(`insert into notifications (user_id, kind, title) values ($1, 'invitation', 'fake')`, [owner.id])),
    );
  });

  it("notifies assignees, and recipients can only mark notifications read", async () => {
    let boardId = "";
    await asUser(db, owner, async (tx) => {
      boardId = (await tx.query<{ id: string }>(`insert into boards (workspace_id, title) values ($1, 'B') returning id`, [ws])).rows[0]!.id;
      const col = (await tx.query<{ id: string }>(`insert into board_columns (workspace_id, board_id, title, position) values ($1, $2, 'Todo', 'a0') returning id`, [ws, boardId])).rows[0]!.id;
      await tx.query(`insert into tasks (workspace_id, board_id, column_id, title, position, assignee_id) values ($1, $2, $3, 'Do it', 'a0', $4)`, [ws, boardId, col, member.id]);
    });
    const notes = await asUser(db, member, (tx) => tx.query<{ id: string; link: string }>(`select id, link from notifications where kind = 'task_assigned'`));
    expect(notes.rows).toHaveLength(1);
    expect(notes.rows[0]!.link).toContain(`/w/${ws}/kanban/${boardId}?task=`);
    const nid = notes.rows[0]!.id;
    await asUser(db, member, (tx) => tx.query(`update notifications set read_at = now() where id = $1`, [nid]));
    expect(await expectError(asUser(db, member, (tx) => tx.query(`update notifications set title = 'x' where id = $1`, [nid])))).toMatch(/Only read_at/);
    expect(await asUser(db, owner, (tx) => count(tx, `select 1 from notifications where id = $1`, [nid]))).toBe(0);
  });
});

describe("storage policies", () => {
  it("members read and editors upload only under their workspace prefix", async () => {
    const path = `${ws}/11111111-1111-4111-8111-111111111111/plan.pdf`;
    await asUser(db, member, (tx) => tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('attachments', $1, $2)`, [path, member.id]));
    expect(await asUser(db, viewer, (tx) => count(tx, `select 1 from storage.objects where name = $1`, [path]))).toBe(1);
    expect(await asUser(db, outsider, (tx) => count(tx, `select 1 from storage.objects where name = $1`, [path]))).toBe(0);
    await expectError(
      asUser(db, viewer, (tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('attachments', $1)`, [`${ws}/22222222-2222-4222-8222-222222222222/v.pdf`])),
    );
    await expectError(
      asUser(db, outsider, (tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('attachments', $1)`, [`${ws}/33333333-3333-4333-8333-333333333333/o.pdf`])),
    );
    // Non-UUID prefixes are denied rather than erroring.
    await expectError(asUser(db, member, (tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('attachments', 'not-a-uuid/x.pdf')`)));
    const del = await asUser(db, outsider, (tx) => tx.query(`delete from storage.objects where name = $1`, [path]));
    expect(del.affectedRows).toBe(0);
  });

  it("attachment metadata must live under its own workspace prefix", async () => {
    await expectError(
      asUser(db, member, (tx) =>
        tx.query(`insert into attachments (workspace_id, storage_path, file_name, mime_type, size_bytes) values ($1, $2, 'a.pdf', 'application/pdf', 10)`, [
          ws,
          `00000000-0000-4000-8000-000000000000/11111111-1111-4111-8111-111111111111/a.pdf`,
        ]),
      ),
    );
    await expectError(
      asUser(db, member, (tx) =>
        tx.query(`insert into attachments (workspace_id, storage_path, file_name, mime_type, size_bytes) values ($1, $2, 'a.exe', 'application/x-msdownload', 10)`, [
          ws,
          `${ws}/11111111-1111-4111-8111-111111111111/a.exe`,
        ]),
      ),
    );
  });
});

describe("realtime private channels", () => {
  it("only members may join or broadcast on ws:<id> topics", async () => {
    const topic = `ws:${ws}`;
    expect(await asUser(db, viewer, (tx) => count(tx, `select 1 from realtime.messages`), { topic })).toBe(0); // allowed, empty
    await asUser(db, member, (tx) => tx.query(`insert into realtime.messages (topic, payload) values ($1, '{}')`, [topic]), { topic });
    expect(await asUser(db, viewer, (tx) => count(tx, `select 1 from realtime.messages`), { topic })).toBe(1);
    expect(await asUser(db, outsider, (tx) => count(tx, `select 1 from realtime.messages`), { topic })).toBe(0);
    await expectError(asUser(db, outsider, (tx) => tx.query(`insert into realtime.messages (topic, payload) values ($1, '{}')`, [topic]), { topic }));
    await expectError(asUser(db, member, (tx) => tx.query(`insert into realtime.messages (topic, payload) values ('ws:garbage', '{}')`), { topic: "ws:garbage" }));
  });
});

describe("collaboration server role", () => {
  it("resolves room access only for current members", async () => {
    const doc = await asUser(db, member, (tx) => tx.query<{ id: string }>(`insert into documents (workspace_id, title) values ($1, 'Spec') returning id`, [ws]));
    const room = `document:${doc.rows[0]!.id}`;
    const access = await asCollabServer(db, (tx) => tx.query<{ role: string; module_enabled: boolean; title: string }>(`select * from collab.room_access($1, $2)`, [room, viewer.id]));
    expect(access.rows[0]).toMatchObject({ role: "viewer", module_enabled: true, title: "Spec" });
    expect(await asCollabServer(db, (tx) => count(tx, `select * from collab.room_access($1, $2)`, [room, outsider.id]))).toBe(0);
    expect(await asCollabServer(db, (tx) => count(tx, `select * from collab.room_access($1, $2)`, ["document:nope", member.id]))).toBe(0);
  });

  it("reads and writes Yjs state but nothing else", async () => {
    const roomId = (await db.query<{ id: string }>(`select id from collaboration_rooms limit 1`)).rows[0]!.id;
    await asCollabServer(db, async (tx) => {
      await tx.query(`insert into collaboration_updates (room_id, data) values ($1, '\\x01'::bytea)`, [roomId]);
      await tx.query(`insert into collaboration_snapshots (room_id, state) values ($1, '\\x00'::bytea)`, [roomId]);
      await tx.query(`select collab.save_preview($1, 'Hello world', $2)`, [roomId, member.id]);
    });
    await expectError(asCollabServer(db, (tx) => tx.query(`select * from documents`)));
    await expectError(asCollabServer(db, (tx) => tx.query(`select * from workspace_members`)));
    await expectError(asCollabServer(db, (tx) => tx.query(`delete from collaboration_rooms`)));
  });

  it("is unreachable for regular users", async () => {
    expect(await asUser(db, owner, (tx) => count(tx, `select 1 from collaboration_updates`)).catch(() => 0)).toBe(0);
    await expectError(asUser(db, owner, (tx) => tx.query(`insert into collaboration_updates (room_id, data) values (gen_random_uuid(), '\\x01')`)));
    await expectError(asUser(db, owner, (tx) => tx.query(`select * from collab.room_access('x', $1)`, [owner.id])));
  });
});
