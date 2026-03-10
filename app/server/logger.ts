/**
 * Structured Logger
 * Single-line logfmt-style entries written to a log file.
 * Format: TIMESTAMP LEVEL CATEGORY event key=value key=value ...
 *
 * Designed for grep, tail -f, and LLM consumption.
 */

import fs from "fs";
import path from "path";

// ── Types ──────────────────────────────────────────────────────────────────

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
  | "TITLE";

export interface LogContext {
  session_id?: string;
  request_id?: string;
  user_id?: string;
}

// ── Configuration ──────────────────────────────────────────────────────────

const LOG_DIR = process.env.LOG_DIR || path.resolve(process.cwd(), "../logs");
const LOG_FILE = path.join(LOG_DIR, "app.log");
const MAX_LOG_SIZE = 50 * 1024 * 1024; // 50 MB before rotation
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};
const MIN_LOG_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "DEBUG";

// ── Ensure log directory exists ────────────────────────────────────────────

try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch {
  // Fall back to console-only
}

// ── Log rotation ───────────────────────────────────────────────────────────

function rotateIfNeeded(): void {
  try {
    if (!fs.existsSync(LOG_FILE)) return;
    const stats = fs.statSync(LOG_FILE);
    if (stats.size >= MAX_LOG_SIZE) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const rotated = LOG_FILE.replace(".log", `.${ts}.log`);
      fs.renameSync(LOG_FILE, rotated);

      // Keep at most 5 rotated files
      const dir = path.dirname(LOG_FILE);
      const rotatedFiles = fs
        .readdirSync(dir)
        .filter((f) => f.match(/^app\.\d.*\.log$/))
        .sort()
        .reverse();
      for (const old of rotatedFiles.slice(5)) {
        try { fs.unlinkSync(path.join(dir, old)); } catch { /* ignore */ }
      }
    }
  } catch {
    // Rotation failure is non-critical
  }
}

// ── Token estimation ───────────────────────────────────────────────────────

/**
 * Estimate token count from a string.
 * ~4 chars/token for English, ~3.5 for JSON/code.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const ratio = text.startsWith("{") || text.startsWith("[") ? 3.5 : 4;
  return Math.ceil(text.length / ratio);
}

// ── Value formatting ───────────────────────────────────────────────────────

function fmtValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    // Quote strings that contain spaces or special chars
    if (value.includes(" ") || value.includes("=") || value.includes('"') || value.includes("\n")) {
      // Escape newlines and quotes, wrap in quotes
      const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
      return `"${escaped}"`;
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  // Objects/arrays: compact JSON, truncated
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

// ── Buffered file writes ───────────────────────────────────────────────────

let buffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushBuffers();
    flushTimer = null;
  }, 100);
}

function flushBuffers(): void {
  if (buffer.length === 0) return;
  try {
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, buffer.join("\n") + "\n");
  } catch { /* ignore file write errors */ }
  buffer = [];
}

process.on("exit", flushBuffers);

// ── Core log function ──────────────────────────────────────────────────────

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

  // Append context
  if (opts?.ctx?.session_id) line += ` sid=${opts.ctx.session_id.slice(0, 8)}`;
  if (opts?.ctx?.request_id) line += ` rid=${opts.ctx.request_id}`;
  if (opts?.ctx?.user_id) line += ` uid=${opts.ctx.user_id.slice(0, 8)}`;

  // Append duration
  if (opts?.duration_ms !== undefined) line += ` duration_ms=${opts.duration_ms}`;

  // Append data key=value pairs
  if (opts?.data) {
    const kv = buildKVPairs(opts.data);
    if (kv) line += ` ${kv}`;
  }

  // Append error
  if (opts?.error) {
    if (opts.error instanceof Error) {
      line += ` error="${opts.error.message.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
      if (opts.error.stack) {
        // First meaningful stack frame
        const frame = opts.error.stack.split("\n").find((l) => l.includes("    at "));
        if (frame) line += ` stack="${frame.trim().replace(/"/g, '\\"')}"`;
      }
    } else {
      line += ` error="${String(opts.error).replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
    }
  }

  // Console output
  if (level === "ERROR") {
    console.error(line);
  } else if (level === "WARN") {
    console.warn(line);
  } else {
    console.log(line);
  }

  // File output
  buffer.push(line);
  scheduleFlush();
}

// ── Public API ─────────────────────────────────────────────────────────────

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
  flush: flushBuffers,
  getLogPath: () => LOG_FILE,
};

// ── Timing helper ──────────────────────────────────────────────────────────

export function startTimer(): () => number {
  const start = performance.now();
  return () => Math.round(performance.now() - start);
}

// ── Request ID generator ───────────────────────────────────────────────────

let requestCounter = 0;
export function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${(++requestCounter).toString(36)}`;
}
