import { createFileSink } from "./logger-file-sink";
import { appConfig } from "./config";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type LogCategory =
  | "STARTUP"
  | "SHUTDOWN"
  | "HTTP"
  | "AUTH"
  | "CHAT"
  | "TOOL"
  | "MCP"
  | "REGISTRY"
  | "DB"
  | "STREAM"
  | "TITLE"
  | "SEARCH"
  | "TRACE";

export interface LogContext {
  session_id?: string;
  request_id?: string;
  user_id?: string;
  turn_id?: string;
}

const LOG_DIR = appConfig.server.log_dir;
const fileSink = createFileSink({ directory: LOG_DIR });
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};
const MIN_LOG_LEVEL: LogLevel = appConfig.server.log_level;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const ratio = text.startsWith("{") || text.startsWith("[") ? 3.5 : 4;
  return Math.ceil(text.length / ratio);
}

function fmtValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    if (value.includes(" ") || value.includes("=") || value.includes('"') || value.includes("\n")) {
      const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
      return `"${escaped}"`;
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const json = JSON.stringify(value);
  if (json.length > 500) {
    return `"${json.slice(0, 500).replace(/"/g, '\\"')}...(${json.length}chars)"`;
  }
  return json;
}

function buildKVPairs(data: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    const formatted = fmtValue(value);
    if (formatted) {
      parts.push(`${key}=${formatted}`);
    }
  }
  return parts.join(" ");
}

process.on("exit", fileSink.flush);

function writeLog(
  level: LogLevel,
  category: LogCategory,
  event: string,
  opts?: {
    data?: Record<string, unknown>;
    error?: Error | string;
    duration_ms?: number;
    ctx?: LogContext;
  }
): void {
  if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[MIN_LOG_LEVEL]) return;

  const ts = new Date().toISOString();
  let line = `${ts} ${level.padEnd(5)} ${category.padEnd(8)} ${event}`;

  if (opts?.ctx?.session_id) line += ` sid=${opts.ctx.session_id.slice(0, 8)}`;
  if (opts?.ctx?.request_id) line += ` rid=${opts.ctx.request_id}`;
  if (opts?.ctx?.user_id) line += ` uid=${opts.ctx.user_id.slice(0, 8)}`;
  if (opts?.ctx?.turn_id) line += ` tid=${opts.ctx.turn_id.slice(0, 8)}`;

  if (opts?.duration_ms !== undefined) line += ` duration_ms=${opts.duration_ms}`;

  if (opts?.data) {
    const kv = buildKVPairs(opts.data);
    if (kv) line += ` ${kv}`;
  }

  if (opts?.error) {
    if (opts.error instanceof Error) {
      line += ` error="${opts.error.message.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
      if (opts.error.stack) {
        const frame = opts.error.stack.split("\n").find((l) => l.includes("    at "));
        if (frame) line += ` stack="${frame.trim().replace(/"/g, '\\"')}"`;
      }
    } else {
      line += ` error="${String(opts.error).replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
    }
  }

  if (level === "ERROR") {
    console.error(line);
  } else if (level === "WARN") {
    console.warn(line);
  } else {
    console.log(line);
  }

  fileSink.write(line);
}

function createLogFn(level: LogLevel) {
  return (
    category: LogCategory,
    event: string,
    opts?: {
      data?: Record<string, unknown>;
      error?: Error | string;
      duration_ms?: number;
      ctx?: LogContext;
    }
  ) => writeLog(level, category, event, opts);
}

export const logger = {
  debug: createLogFn("DEBUG"),
  info: createLogFn("INFO"),
  warn: createLogFn("WARN"),
  error: createLogFn("ERROR"),
  flush: fileSink.flush,
  getLogPath: () => fileSink.file,
};

export function startTimer(): () => number {
  const start = performance.now();
  return () => Math.round(performance.now() - start);
}

let requestCounter = 0;
export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${(++requestCounter).toString(36)}`;
}
