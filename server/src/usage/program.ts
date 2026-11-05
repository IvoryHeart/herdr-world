import { createUsageProjection } from "./projection";
import { collectHarnessUsage, type CollectorOptions } from "./collector";

/** Stop streaming decompression at the same per-file output budget as plain logs. */
export async function boundedUsageDecompress(
  value: Uint8Array,
): Promise<Uint8Array> {
  const Decoder = DecompressionStream as unknown as new (
    format: string,
  ) => ReadableWritablePair<Uint8Array, Uint8Array>;
  const reader = new Response(Uint8Array.from(value))
    .body!.pipeThrough(new Decoder("zstd"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return Buffer.concat(chunks, size);
      size += next.value.length;
      if (size > 64 * 1024 * 1024) throw new Error("Usage decompression limit");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/** Static code only for long-lived readers; request paths travel over IPC/stdin. */
export function usageHostProgram(
  options?: CollectorOptions,
  mode: "stdio" | "ssh" | "worker" = "stdio",
) {
  return `${mode === "ssh" ? `process.stdin.once('end', () => process.exit(1)); process.once('SIGHUP', () => process.exit(1));` : ""}
const fs = await import('node:fs/promises');
const os = await import('node:os');
const path = await import('node:path');
const crypto = await import('node:crypto');
const zlib = await import('node:zlib');
const project = ${createUsageProjection.toString()};
const collect = ${collectHarnessUsage.toString()};
const boundedDecompress = ${boundedUsageDecompress.toString()};
const cache = { files: new Map(), sessions: new Map() };
const ports = { fs, home: os.homedir(), env: process.env, join: path.join, resolve: path.resolve,
hash: value => crypto.createHash('sha256').update(value).digest('hex'),
decompress: typeof Bun !== 'undefined' ? boundedDecompress :
typeof zlib.zstdDecompressSync === 'function' ? value => zlib.zstdDecompressSync(value, { maxOutputLength: 67108864 }) : undefined };
const write = value => new Promise((resolve, reject) => process.stdout.write(JSON.stringify(value)+'\\n', error => error ? reject(error) : resolve()));
${
  mode === "stdio"
    ? `await write(await collect(${JSON.stringify(options)}, project, ports, cache));`
    : mode === "worker"
      ? `const {parentPort} = await import('node:worker_threads');
let queue = Promise.resolve();
parentPort.on('message', request => { queue = queue.then(async () => {
try { parentPort.postMessage({ id: request.id, value: await collect(request.options, project, ports, cache) }); }
catch { parentPort.postMessage({ id: request.id, error: true }); }
}); });`
      : `const readline = await import('node:readline');
const input = readline.createInterface({input:process.stdin, crlfDelay:Infinity});
for await (const line of input) {
if (Buffer.byteLength(line)>262144) process.exit(1);
const request=JSON.parse(line), deadline=setTimeout(()=>process.exit(1),20000);
try { await write({ id:request.id, value:await collect(request.options,project,ports,cache) }); }
catch { await write({ id:request.id, error:true }); }
finally {clearTimeout(deadline);}
}`
}`;
}
