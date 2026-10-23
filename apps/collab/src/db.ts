import pg from "pg";

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** The narrow database surface the collaboration server needs. */
export interface Db extends Queryable {
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export function createPgDb(connectionString: string): Db {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Supabase requires TLS; local Postgres usually does not.
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: false },
  });
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await pool.query(sql, params);
      return { rows: r.rows as T[] };
    },
    async transaction<T>(fn: (q: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn({
          async query<R>(sql: string, params: unknown[] = []) {
            const r = await client.query(sql, params);
            return { rows: r.rows as R[] };
          },
        });
        await client.query("commit");
        return result;
      } catch (err) {
        await client.query("rollback").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async ping() {
      try {
        await pool.query("select 1");
        return true;
      } catch {
        return false;
      }
    },
    close: () => pool.end(),
  };
}

export function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string" && value.startsWith("\\x")) return Buffer.from(value.slice(2), "hex");
  throw new Error("Unexpected bytea value");
}
