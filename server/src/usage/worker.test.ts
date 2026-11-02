import { expect, test } from "bun:test";
import { MessageChannel, Worker } from "node:worker_threads";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectHarnessUsage } from "./collector";
import { createUsageProjection } from "./projection";
import { runUsageWorker } from "./worker";
import { usageScope } from "./lifetime";

for (const phase of ["metadata", "read", "decompression"])
  test(`owned worker cancellation terminates a blocked ${phase} operation`, async () => {
    const root = await fs.mkdtemp(join(tmpdir(), "usage-cancel-"));
    const path = join(
      root,
      phase === "decompression" ? "synthetic.jsonl.zst" : "synthetic.jsonl",
    );
    await fs.writeFile(
      path,
      phase === "decompression" ? Bun.zstdCompressSync("{}\n") : "{}\n",
    );
    const { port1, port2 } = new MessageChannel();
    const started = Promise.withResolvers<void>();
    port1.once("message", () => started.resolve());
    const program = `const {parentPort,workerData}=await import('node:worker_threads');
const realFs=await import('node:fs/promises'), crypto=await import('node:crypto'), path=await import('node:path');
const fs={...realFs};
const block=async()=>{workerData.postMessage('blocked');return new Promise(()=>{});};
${phase === "metadata" ? "fs.lstat=block;" : phase === "read" ? "fs.open=async()=>({read:block,close:async()=>{}});" : ""}
const collect=${collectHarnessUsage.toString()}, project=${createUsageProjection.toString()};
const result=await collect(${JSON.stringify({ now: Date.now() + 1, files: [{ harness: "codex", path }] })},project,{
fs,home:${JSON.stringify(root)},env:{},join:path.join,
hash:value=>crypto.createHash('sha256').update(value).digest('hex'),decompress:block});
parentPort.postMessage(result);`;
    const controller = new AbortController();
    let exited = false;
    const work = runUsageWorker(program, controller.signal, (source) => {
      const worker = new Worker(
        new URL(`data:text/javascript,${encodeURIComponent(source)}`),
        { workerData: port2, transferList: [port2] },
      );
      worker.once("exit", () => {
        exited = true;
      });
      return worker;
    });
    void work.catch(started.reject);
    try {
      await started.promise;
      controller.abort();
      await expect(work).rejects.toThrow("cancelled");
      expect(exited).toBe(true);
    } finally {
      controller.abort();
      await work.catch(() => {});
      port1.close();
      port2.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

test("the operation deadline terminates a worker without waiting for its blocked source", async () => {
  const owner = usageScope(undefined, 10);
  let exited = false;
  try {
    await expect(
      runUsageWorker("await new Promise(()=>{});", owner.signal, (program) => {
        const worker = new Worker(
          new URL(`data:text/javascript,${encodeURIComponent(program)}`),
        );
        worker.once("exit", () => {
          exited = true;
        });
        return worker;
      }),
    ).rejects.toThrow("cancelled");
    expect(exited).toBe(true);
  } finally {
    owner.dispose();
  }
});
