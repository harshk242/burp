import { expect, it } from "bun:test";
import { createFileSink, type FileSinkOptions } from "../logger-file-sink";

function fixture() {
  const reports: string[] = [];
  const writes: string[] = [];
  const io = {
    mkdirSync() {}, existsSync: () => false, statSync: () => ({ size: 100 }),
    renameSync() {}, readdirSync: () => [] as string[], unlinkSync() {},
    appendFileSync(_file: string, text: string) { writes.push(text); },
  };
  const sink = createFileSink({ directory: "/tmp/m5-sink", fs: io as unknown as FileSinkOptions["fs"], report: (m) => reports.push(m), maxSize: 1, maxBufferBytes: 32 });
  return { io, sink, reports, writes };
}

it("reports append and mkdir failures, retaining buffered entries for recovery", () => {
  const { io, sink, reports, writes } = fixture();
  const append = io.appendFileSync;
  io.appendFileSync = () => { throw new Error("disk full"); };
  sink.write("retained");
  expect(() => sink.flush()).not.toThrow();
  expect(reports.some((m) => m.includes("operation=append"))).toBe(true);
  io.mkdirSync = () => { throw new Error("permission denied"); };
  sink.flush();
  expect(reports.some((m) => m.includes("operation=mkdir"))).toBe(true);
  io.mkdirSync = () => {};
  io.appendFileSync = append;
  sink.flush();
  expect(writes).toEqual(["retained\n"]);
});

it("bounds buffering, retries and repeated error reports while remaining nonfatal", async () => {
  const { io, sink, reports, writes } = fixture();
  let attempts = 0;
  io.appendFileSync = () => { attempts++; throw new Error("offline"); };
  sink.write("first");
  for (let i = 0; i < 6; i++) sink.flush();
  sink.write("x".repeat(32));
  sink.flush();
  const flushed = attempts;
  await Bun.sleep(20);
  expect(attempts).toBe(flushed);
  expect(reports.filter((m) => m.includes("operation=append"))).toHaveLength(1);
  expect(reports.some((m) => m.includes("operation=buffer_full"))).toBe(true);
  io.appendFileSync = (_file, text) => { writes.push(text); };
  sink.flush();
  expect(writes).toEqual(["first\n"]);
});

it("reports rotation and retention failures without preventing append", () => {
  const { io, sink, reports, writes } = fixture();
  io.existsSync = () => true;
  io.renameSync = () => { throw new Error("rename failed"); };
  io.readdirSync = () => Array.from({ length: 7 }, (_, i) => `app.2026-${i}.log`);
  io.unlinkSync = () => { throw new Error("unlink failed"); };
  sink.write("logged");
  sink.flush();
  expect(reports.some((m) => m.includes("operation=rotation"))).toBe(true);
  expect(reports.some((m) => m.includes("operation=retention"))).toBe(true);
  expect(writes).toEqual(["logged\n"]);
});
