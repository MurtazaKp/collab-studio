import { describe, expect, it } from "vitest";
import { createTestDb, createUser, migrationFiles } from "./support/db";

describe("migrations", () => {
  it("apply cleanly to an empty database, including the seed file", async () => {
    const db = await createTestDb({ seed: true });
    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_tables where schemaname = 'public'`,
    );
    expect(r.rows[0]!.n).toBeGreaterThanOrEqual(25);
    expect(migrationFiles().length).toBeGreaterThanOrEqual(5);
  });

  it("seed function builds a full demo workspace for an existing user", async () => {
    const db = await createTestDb({ seed: true });
    const user = await createUser(db, "Demo");
    const r = await db.query<{ ws: string }>(`select dev.seed_demo_workspace($1) as ws`, [user.id]);
    const ws = r.rows[0]!.ws;
    const counts = await db.query<Record<string, number>>(
      `select
         (select count(*)::int from documents where workspace_id = $1) as docs,
         (select count(*)::int from tasks where workspace_id = $1) as tasks,
         (select count(*)::int from messages where workspace_id = $1) as messages,
         (select count(*)::int from collaboration_rooms where workspace_id = $1) as rooms,
         (select count(*)::int from shopping_items where workspace_id = $1 and checked_by = $2) as checked`,
      [ws, user.id],
    );
    expect(counts.rows[0]).toEqual({ docs: 3, tasks: 5, messages: 4, rooms: 6, checked: 1 });
    await expect(db.query(`select dev.seed_demo_workspace(gen_random_uuid())`)).rejects.toThrow(/sign up first/);
  });

  it("index every foreign key (by its leading column)", async () => {
    const db = await createTestDb();
    const r = await db.query<{ fk: string }>(`
      select c.conrelid::regclass::text || '.' || c.conname as fk
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where c.contype = 'f' and n.nspname = 'public'
        and not exists (
          select 1 from pg_index i where i.indrelid = c.conrelid and (i.indkey::int2[])[0] = c.conkey[1]
        )`);
    expect(r.rows.map((x) => x.fk)).toEqual([]);
  });

  it("enable RLS on every public table", async () => {
    const db = await createTestDb();
    const r = await db.query<{ tablename: string }>(
      `select c.relname as tablename from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(r.rows.map((x) => x.tablename)).toEqual([]);
  });

  it("add structured tables (but not Yjs state) to the realtime publication", async () => {
    const db = await createTestDb();
    const r = await db.query<{ tablename: string }>(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime'`,
    );
    const names = r.rows.map((x) => x.tablename);
    for (const t of ["tasks", "messages", "playlist_items", "shopping_items", "notifications"]) {
      expect(names).toContain(t);
    }
    expect(names).not.toContain("collaboration_updates");
    expect(names).not.toContain("invitations");
  });

  it("create a private attachments bucket", async () => {
    const db = await createTestDb();
    const r = await db.query<{ id: string; public: boolean }>(`select id, public from storage.buckets`);
    expect(r.rows).toEqual([{ id: "attachments", public: false }]);
  });

  it("expose no SECURITY DEFINER function in public without a pinned search_path", async () => {
    const db = await createTestDb();
    const r = await db.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public','collab') and p.prosecdef
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    );
    expect(r.rows).toEqual([]);
  });
});
