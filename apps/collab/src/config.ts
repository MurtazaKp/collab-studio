export interface CollabConfig {
  port: number;
  host: string;
  databaseUrl: string;
  jwtSecret: string;
  /** Origins allowed to open WebSocket connections. Empty = allow any (dev only). */
  allowedOrigins: string[];
  /** How often open sessions are re-authorized against the database. */
  recheckIntervalMs: number;
  /** Batch window for appending Yjs updates to the database. */
  flushIntervalMs: number;
  /** Compact the update log into a snapshot after this many rows. */
  compactThreshold: number;
  /** Max inbound WebSocket message size in bytes. */
  maxPayloadBytes: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CollabConfig {
  const missing = ["COLLAB_DATABASE_URL", "COLLAB_JWT_SECRET"].filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  const secret = env.COLLAB_JWT_SECRET!;
  if (secret.length < 32) throw new Error("COLLAB_JWT_SECRET must be at least 32 characters");
  const level = (env.LOG_LEVEL ?? "info") as CollabConfig["logLevel"];
  return {
    port: int("PORT", 1234),
    host: env.HOST ?? "0.0.0.0",
    databaseUrl: env.COLLAB_DATABASE_URL!,
    jwtSecret: secret,
    allowedOrigins: (env.COLLAB_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    recheckIntervalMs: int("COLLAB_RECHECK_INTERVAL_MS", 15_000),
    flushIntervalMs: int("COLLAB_FLUSH_INTERVAL_MS", 150),
    compactThreshold: int("COLLAB_COMPACT_THRESHOLD", 200),
    maxPayloadBytes: int("COLLAB_MAX_PAYLOAD_BYTES", 4 * 1024 * 1024),
    logLevel: ["debug", "info", "warn", "error"].includes(level) ? level : "info",
  };
}
