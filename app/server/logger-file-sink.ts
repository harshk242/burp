import fs from "node:fs";
import path from "node:path";

export interface FileSinkOptions {
  directory: string;
  fs?: Pick<typeof fs, "mkdirSync" | "existsSync" | "statSync" | "renameSync" | "readdirSync" | "unlinkSync" | "appendFileSync">;
  report?: (message: string) => void;
  maxSize?: number;
  maxBufferBytes?: number;
  retryMs?: number;
}

export function createFileSink(options: FileSinkOptions) {
  const io = options.fs ?? fs;
  const file = path.join(options.directory, "app.log");
  const report = options.report ?? ((message: string) => process.stderr.write(`${message}\n`));
  let buffer = "";
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const reported = new Map<string, number>();

  function failure(operation: string, error: unknown): void {
    const now = Date.now();
    if (now - (reported.get(operation) ?? -Infinity) < 30_000) return;
    reported.set(operation, now);
    report(`log_file_sink_failed operation=${operation} path=${file} error=${JSON.stringify(String(error))}`);
  }

  function rotate(): void {
    try {
      if (!io.existsSync(file) || io.statSync(file).size < (options.maxSize ?? 50 * 1024 * 1024)) return;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      io.renameSync(file, path.join(options.directory, `app.${stamp}.log`));
    } catch (error) { failure("rotation", error); }
    try {
      const files = io.readdirSync(options.directory).filter((f) => /^app\.\d.*\.log$/.test(f)).sort().reverse();
      for (const old of files.slice(5)) {
        try { io.unlinkSync(path.join(options.directory, old)); }
        catch (error) { failure("retention", error); }
      }
    } catch (error) { failure("retention_scan", error); }
  }

  function schedule(delay = 100): void {
    if (timer || failures >= 5) return;
    timer = setTimeout(() => { timer = null; flush(); }, delay);
    timer.unref?.();
  }

  function retry(): void {
    failures++;
    schedule(Math.min((options.retryMs ?? 1000) * 2 ** (failures - 1), 30_000));
  }

  function flush(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!buffer) return;
    try { io.mkdirSync(options.directory, { recursive: true }); }
    catch (error) { failure("mkdir", error); retry(); return; }
    rotate();
    try {
      io.appendFileSync(file, buffer);
      buffer = "";
      failures = 0;
      reported.delete("mkdir");
      reported.delete("append");
    } catch (error) { failure("append", error); retry(); }
  }

  function write(line: string): void {
    const entry = `${line}\n`;
    if (Buffer.byteLength(buffer) + Buffer.byteLength(entry) > (options.maxBufferBytes ?? 1024 * 1024)) {
      failure("buffer_full", new Error("File log buffer exhausted; incoming file entry dropped"));
    } else buffer += entry;
    if (failures >= 5) failures = 0;
    schedule(failures ? Math.min((options.retryMs ?? 1000) * 2 ** (failures - 1), 30_000) : 100);
  }

  return { write, flush, file };
}
