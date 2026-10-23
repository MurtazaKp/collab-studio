/**
 * Generates apps/web/src/lib/supabase/database.types.ts from the migrations.
 *
 * Applies every migration to an in-memory PGlite database (with the Supabase
 * shim used by the DB tests) and introspects tables, foreign keys and RPC
 * functions into the shape supabase-js expects. CHECK constraints of the form
 * `col = ANY (ARRAY['a', 'b'])` become string-literal unions.
 *
 * With a running Supabase project you can use `supabase gen types` instead;
 * this script exists so types stay reproducible without Docker.
 *
 *   npm run db:types
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDb } from "../supabase/tests/support/db";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "apps", "web", "src", "lib", "supabase", "database.types.ts");

const SCALARS: Record<string, string> = {
  uuid: "string",
  text: "string",
  varchar: "string",
  bpchar: "string",
  citext: "string",
  date: "string",
  timestamptz: "string",
  timestamp: "string",
  time: "string",
  interval: "string",
  bytea: "string",
  int2: "number",
  int4: "number",
  int8: "number",
  numeric: "number",
  float4: "number",
  float8: "number",
  bool: "boolean",
  json: "Json",
  jsonb: "Json",
  void: "undefined",
  record: "Json",
};

function tsType(udt: string): string {
  if (udt.startsWith("_")) return `${tsType(udt.slice(1))}[]`;
  return SCALARS[udt] ?? "unknown";
}

async function main() {
  const db = await createTestDb();

  const cols = await db.query<{
    table_name: string;
    column_name: string;
    udt_name: string;
    is_nullable: "YES" | "NO";
    column_default: string | null;
    is_identity: "YES" | "NO";
    is_generated: string;
  }>(`
    select c.table_name, c.column_name, c.udt_name, c.is_nullable, c.column_default, c.is_identity, c.is_generated
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
    order by c.table_name, c.ordinal_position`);

  const checks = await db.query<{ table_name: string; def: string }>(`
    select cl.relname as table_name, pg_get_constraintdef(co.oid) as def
    from pg_constraint co
    join pg_class cl on cl.oid = co.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = 'public' and co.contype = 'c'`);

  const fks = await db.query<{
    name: string;
    table_name: string;
    columns: string[];
    ref_table: string;
    ref_columns: string[];
    one_to_one: boolean;
  }>(`
    select co.conname as name, cl.relname as table_name,
      array(select a.attname::text from unnest(co.conkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = co.conrelid and a.attnum = k.n order by k.i) as columns,
      rcl.relname as ref_table,
      array(select a.attname::text from unnest(co.confkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = co.confrelid and a.attnum = k.n order by k.i) as ref_columns,
      exists (
        select 1 from pg_index ix where ix.indrelid = co.conrelid and ix.indisunique
          and (select array_agg(x order by x) from unnest(ix.indkey::int2[]) x) = (select array_agg(x order by x) from unnest(co.conkey) x)
      ) as one_to_one
    from pg_constraint co
    join pg_class cl on cl.oid = co.conrelid
    join pg_class rcl on rcl.oid = co.confrelid
    join pg_namespace n on n.oid = cl.relnamespace
    join pg_namespace rn on rn.oid = rcl.relnamespace
    where n.nspname = 'public' and rn.nspname = 'public' and co.contype = 'f'
    order by cl.relname, co.conname`);

  const fns = await db.query<{
    name: string;
    arg_names: string[] | null;
    arg_types: string[];
    arg_modes: string[] | null;
    arg_defaults: number;
    ret_type: string;
    ret_set: boolean;
  }>(`
    select p.proname as name, p.proargnames as arg_names,
      array(select t.typname::text from unnest(coalesce(p.proallargtypes, p.proargtypes::oid[])) with ordinality a(oid, i) join pg_type t on t.oid = a.oid order by a.i) as arg_types,
      p.proargmodes::text[] as arg_modes, p.pronargdefaults as arg_defaults,
      rt.typname as ret_type, p.proretset as ret_set
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_type rt on rt.oid = p.prorettype
    where n.nspname = 'public' and p.prokind = 'f'
      and rt.typname <> 'trigger'
      and has_function_privilege('authenticated', p.oid, 'execute')
    order by p.proname`);

  // Literal unions from CHECK (col = ANY (ARRAY['a'::text, ...])) and (col IN (...)).
  const unions = new Map<string, string>();
  for (const c of checks.rows) {
    const re = /\(?(\w+) = ANY \(\(?ARRAY\[([^\]]+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(c.def))) {
      const values = [...m[2]!.matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1]!.replace(/''/g, "'"));
      if (values.length) unions.set(`${c.table_name}.${m[1]}`, values.map((v) => JSON.stringify(v)).join(" | "));
    }
  }

  const tables = new Map<string, typeof cols.rows>();
  for (const c of cols.rows) tables.set(c.table_name, [...(tables.get(c.table_name) ?? []), c]);

  const lines: string[] = [];
  lines.push("// Generated by scripts/generate-db-types.ts — do not edit by hand. Run `npm run db:types`.");
  lines.push("export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];");
  lines.push("");
  lines.push("export type Database = {");
  lines.push('  __InternalSupabase: { PostgrestVersion: "12" };');
  lines.push("  public: {");
  lines.push("    Tables: {");
  for (const [table, columns] of tables) {
    const typeOf = (c: (typeof columns)[number]) => {
      const base = unions.get(`${table}.${c.column_name}`) ?? tsType(c.udt_name);
      return c.is_nullable === "YES" ? `${base} | null` : base;
    };
    lines.push(`      ${table}: {`);
    lines.push("        Row: {");
    for (const c of columns) lines.push(`          ${c.column_name}: ${typeOf(c)};`);
    lines.push("        };");
    lines.push("        Insert: {");
    for (const c of columns) {
      if (c.is_identity === "YES" && c.column_default === null) {
        lines.push(`          ${c.column_name}?: never;`);
        continue;
      }
      const optional = c.is_nullable === "YES" || c.column_default !== null || c.is_identity === "YES";
      lines.push(`          ${c.column_name}${optional ? "?" : ""}: ${typeOf(c)};`);
    }
    lines.push("        };");
    lines.push("        Update: {");
    for (const c of columns) lines.push(`          ${c.column_name}?: ${typeOf(c)};`);
    lines.push("        };");
    lines.push("        Relationships: [");
    for (const fk of fks.rows.filter((f) => f.table_name === table)) {
      lines.push(
        `          { foreignKeyName: ${JSON.stringify(fk.name)}; columns: ${JSON.stringify(fk.columns)}; isOneToOne: ${fk.one_to_one}; referencedRelation: ${JSON.stringify(fk.ref_table)}; referencedColumns: ${JSON.stringify(fk.ref_columns)} },`,
      );
    }
    lines.push("        ];");
    lines.push("      };");
  }
  lines.push("    };");
  lines.push("    Views: { [_ in never]: never };");
  lines.push("    Functions: {");
  for (const f of fns.rows) {
    const modes = f.arg_modes ?? f.arg_types.map(() => "i");
    const names = f.arg_names ?? [];
    const inputs: string[] = [];
    const outputs: string[] = [];
    const inputCount = modes.filter((m) => m === "i" || m === "b").length;
    let inputIdx = 0;
    modes.forEach((mode, i) => {
      const name = names[i] ?? `arg${i}`;
      const type = tsType(f.arg_types[i]!);
      if (mode === "i" || mode === "b") {
        const optional = inputIdx >= inputCount - f.arg_defaults;
        inputs.push(`${name}${optional ? "?" : ""}: ${type}`);
        inputIdx++;
      }
      if (mode === "t" || mode === "o" || mode === "b") outputs.push(`${name}: ${type}`);
    });
    const args = inputs.length ? `{ ${inputs.join("; ")} }` : "Record<PropertyKey, never>";
    let ret: string;
    if (outputs.length) ret = `{ ${outputs.join("; ")} }${f.ret_set ? "[]" : ""}`;
    else ret = `${tsType(f.ret_type)}${f.ret_set ? "[]" : ""}`;
    lines.push(`      ${f.name}: { Args: ${args}; Returns: ${ret} };`);
  }
  lines.push("    };");
  lines.push("    Enums: { [_ in never]: never };");
  lines.push("    CompositeTypes: { [_ in never]: never };");
  lines.push("  };");
  lines.push("};");
  lines.push("");
  lines.push('type PublicSchema = Database["public"];');
  lines.push('export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];');
  lines.push('export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];');
  lines.push('export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];');
  lines.push("");

  writeFileSync(OUT, lines.join("\n"));
  console.log(`Wrote ${OUT} (${tables.size} tables, ${fns.rows.length} functions)`);
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
