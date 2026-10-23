/**
 * Lists foreign keys in the public schema that have no index starting with the
 * FK's columns. Unindexed FKs make cascading deletes and parent lookups scan
 * the whole child table. Runs the migrations on in-memory PGlite only.
 *
 *   npx tsx scripts/check-fk-indexes.ts
 */
import { createTestDb } from "../supabase/tests/support/db";

const db = await createTestDb();
const r = await db.query<{ table_name: string; fk: string; columns: string }>(`
  select c.conrelid::regclass::text as table_name, c.conname as fk,
         (select string_agg(a.attname, ', ' order by k.i)
            from unnest(c.conkey) with ordinality k(n, i)
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n) as columns
  from pg_constraint c
  join pg_namespace n on n.oid = (select relnamespace from pg_class where oid = c.conrelid)
  where c.contype = 'f' and n.nspname = 'public'
    and not exists (
      select 1 from pg_index i
      where i.indrelid = c.conrelid
        -- An index led by the FK's first column serves cascade/parent lookups.
        and (i.indkey::int2[])[0] = c.conkey[1]
    )
  order by 1, 2`);
for (const row of r.rows) console.log(`${row.table_name}.${row.fk} (${row.columns})`);
console.log(`${r.rows.length} foreign key(s) without a leading index`);
await db.close();
process.exit(r.rows.length ? 1 : 0);
