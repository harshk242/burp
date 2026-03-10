/**
 * Structured Logger
 * Writes human-readable logs and machine-parseable JSONL to files.
 * Designed for debugging agent behavior, tool calls, and backend processes.
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

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  data?: Record<string, unknown>;
  error?: { message: string; stack?: string };
  duration_ms?: number;
  request_id?: string;
  session_id?: string;
  user_id?: string;
}

// ── Configuration ──────────────────────────────────────────────────────────

const LOG_DIR = process.env.LOG_DIR || path.resolve(process.cwd(), "../logs");
const LOG_FILE = path.join(LOG_DIR, "app.log");
const JSONL_FILE = path.join(LOG_DIR, "app.jsonl");
const MAX_LOG_SIZE = 50 * 1024 * 1024; // 50 MB before rotation
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};
const MIN_LOG_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "DEBUG";

// ── Ensure log directory exists ────────────────────────────────────────────

function ensureLogDir(): void {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch {
    // Fall back to console-only if we can't create the log directory
  }
}

ensureLogDir();

// ── Log rotation ───────────────────────────────────────────────────────────

function rotateIfNeeded(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const stats = fs.statSync(filePath);
    if (stats.size >= MAX_LOG_SIZE) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const ext = path.extname(filePath);
      const base = filePath.slice(0, -ext.length);
      const rotatedPath = `${base}.${timestamp}${ext}`;
      fs.renameSync(filePath, rotatedPath);

      // Keep at most 5 rotated files
      const dir = path.dirname(filePath);
      const baseName = path.basename(base);
      const rotatedFiles = fs
        .readdirSync(dir)
        .filter((f) => f.startsWith(baseName) && f !== path.basename(filePath))
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
 * Uses a simple heuristic: ~4 characters per token for English text,
 * ~3 for JSON/code. This is a rough estimate, not exact.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // JSON and structured data is ~3.5 chars per token
  const ratio = text.startsWith("{") || text.startsWith("[") ? 3.5 : 4;
  return Math.ceil(text.length / ratio);
}

/**
 * Get byte size of a string (useful for understanding output size).
 */
export function byteSize(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

// ── Formatting ─────────────────────────────────────────────────────────────

const LEVEL_COLORS: Record<LogLevel, string> = {
  DEBUG: "\x1b[36m", // cyan
  INFO: "\x1b[32m",  // green
  WARN: "\x1b[33m",  // yellow
  ERROR: "\x1b[31m", // red
};
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

function formatTimestamp(iso: string): string {
  // "2024-01-15T10:30:45.123Z" → "2024-01-15 10:30:45.123"
  return iso.replace("T", " ").replace("Z", "");
}

function formatForConsole(entry: LogEntry): string {
  const ts = DIM + formatTimestamp(entry.timestamp) + RESET;
  const lvl = LEVEL_COLORS[entry.level] + entry.level.padEnd(5) + RESET;
  const cat = BOLD + `[${entry.category}]` + RESET;
  let line = `${ts} ${lvl} ${cat} ${entry.message}`;

  if (entry.session_id) {
    line += ` ${DIM}sid=${entry.session_id.slice(0, 8)}${RESET}`;
  }
  if (entry.request_id) {
    line += ` ${DIM}rid=${entry.request_id.slice(0, 8)}${RESET}`;
  }
  if (entry.duration_ms !== undefined) {
    line += ` ${DIM}(${entry.duration_ms}ms)${RESET}`;
  }
  if (entry.data) {
    const dataStr = formatDataCompact(entry.data);
    if (dataStr) {
      line += `\n  ${DIM}${dataStr}${RESET}`;
    }
  }
  if (entry.error) {
    line += `\n  ${LEVEL_COLORS.ERROR}Error: ${entry.error.message}${RESET}`;
    if (entry.error.stack) {
      const stackLines = entry.error.stack.split("\n").slice(1, 4);
      line += `\n  ${DIM}${stackLines.join("\n  ")}${RESET}`;
    }
  }

  return line;
}

function formatForFile(entry: LogEntry): string {
  const ts = formatTimestamp(entry.timestamp);
  const lvl = entry.level.padEnd(5);
  const cat = `[${entry.category}]`;
  let line = `${ts} ${lvl} ${cat} ${entry.message}`;

  if (entry.session_id) line += ` sid=${entry.session_id.slice(0, 8)}`;
  if (entry.request_id) line += ` rid=${entry.request_id.slice(0, 8)}`;
  if (entry.user_id) line += ` uid=${entry.user_id.slice(0, 8)}`;
  if (entry.duration_ms !== undefined) line += ` (${entry.duration_ms}ms)`;

  if (entry.data) {
    const dataStr = formatDataReadable(entry.data);
    if (dataStr) {
      line += `\n    ${dataStr}`;
    }
  }
  if (entry.error) {
    line += `\n    Error: ${entry.error.message}`;
    if (entry.error.stack) {
      const stackLines = entry.error.stack.split("\n").slice(1, 6);
      line += `\n    ${stackLines.join("\n    ")}`;
    }
  }

  return line;
}

function formatDataCompact(data: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.length > 200) {
      parts.push(`${key}="${value.slice(0, 200)}..." (${value.length} chars)`);
    } else if (typeof value === "object") {
      const str = JSON.stringify(value);
      parts.push(`${key}=${str.length > 200 ? str.slice(0, 200) + "..." : str}`);
    } else {
      parts.push(`${key}=${value}`);
    }
  }
  return parts.join("  ");
}

function formatDataReadable(data: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.length > 500) {
      parts.push(`${key}: "${value.slice(0, 500)}..." (${value.length} chars)`);
    } else if (typeof value === "object") {
      const str = JSON.stringify(value, null, 2);
      if (str.length > 500) {
        parts.push(`${key}: ${str.slice(0, 500)}... (${str.length} chars)`);
      } else {
        parts.push(`${key}: ${str}`);
      }
    } else {
      parts.push(`${key}: ${value}`);
    }
  }
  return parts.join("\n    ");
}

// ── Write buffers (batched I/O) ────────────────────────────────────────────

let logBuffer: string[] = [];
let jsonlBuffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushBuffers();
    flushTimer = null;
  }, 100); // Flush every 100ms max
}

function flushBuffers(): void {
  if (logBuffer.length > 0) {
    try {
      rotateIfNeeded(LOG_FILE);
      fs.appendFileSync(LOG_FILE, logBuffer.join("\n") + "\n");
    } catch { /* ignore file write errors */ }
    logBuffer = [];
  }
  if (jsonlBuffer.length > 0) {
    try {
      rotateIfNeeded(JSONL_FILE);
      fs.appendFileSync(JSONL_FILE, jsonlBuffer.join("\n") + "\n");
    } catch { /* ignore file write errors */ }
    jsonlBuffer = [];
  }
}

// Flush on process exit
process.on("exit", flushBuffers);

// ── Core log function ──────────────────────────────────────────────────────

function log(entry: LogEntry): void {
  // Check log level
  if (LOG_LEVEL_PRIORITY[entry.level] < LOG_LEVEL_PRIORITY[MIN_LOG_LEVEL]) {
    return;
  }

  // Console output
  const consoleLine = formatForConsole(entry);
  if (entry.level === "ERROR") {
    console.error(consoleLine);
  } else if (entry.level === "WARN") {
    console.warn(consoleLine);
  } else {
    console.log(consoleLine);
  }

  // File output (human-readable)
  logBuffer.push(formatForFile(entry));

  // JSONL output (machine-readable)
  jsonlBuffer.push(JSON.stringify(entry));

  scheduleFlush();
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface LogContext {
  session_id?: string;
  request_id?: string;
  user_id?: string;
}

function createLogFn(level: LogLevel) {
  return (
    category: LogCategory,
    message: string,
    opts?: {
      data?: Record<string, unknown>;
      error?: Error | string;
      duration_ms?: number;
      ctx?: LogContext;
    }
  ): void => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data: opts?.data,
      duration_ms: opts?.duration_ms,
      session_id: opts?.ctx?.session_id,
      request_id: opts?.ctx?.request_id,
      user_id: opts?.ctx?.user_id,
    };

    if (opts?.error) {
      if (opts.error instanceof Error) {
        entry.error = {
          message: opts.error.message,
          stack: opts.error.stack,
        };
      } else {
        entry.error = { message: opts.error };
      }
    }

    log(entry);
  };
}

export const logger = {
  debug: createLogFn("DEBUG"),
  info: createLogFn("INFO"),
  warn: createLogFn("WARN"),
  error: createLogFn("ERROR"),

  /** Flush pending log writes immediately */
  flush: flushBuffers,

  /** Get log file paths */
  getLogPaths: () => ({ log: LOG_FILE, jsonl: JSONL_FILE }),
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
