/**
 * Structured JSON logs. Never pass tokens, document content or raw updates;
 * log identifiers (room, user id) and sizes only.
 */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(level: Level = "info", sink: (line: string) => void = (l) => process.stdout.write(l + "\n")): Logger {
  const min = ORDER[level];
  const log = (lvl: Level, msg: string, fields?: Record<string, unknown>) => {
    if (ORDER[lvl] < min) return;
    const entry: Record<string, unknown> = { ts: new Date().toISOString(), level: lvl, msg, ...fields };
    if (fields?.err instanceof Error) {
      entry.err = { name: fields.err.name, message: fields.err.message };
    }
    sink(JSON.stringify(entry));
  };
  return {
    debug: (m, f) => log("debug", m, f),
    info: (m, f) => log("info", m, f),
    warn: (m, f) => log("warn", m, f),
    error: (m, f) => log("error", m, f),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
