/** Plain and compressed files are two representations of one transcript. */
export function plainTranscriptPath(path: string) {
  return path.endsWith(".jsonl.zst") ? path.slice(0, -4) : path;
}

export function transcriptPaths(path: string) {
  const plain = plainTranscriptPath(path);
  return plain.endsWith(".jsonl") ? [plain, `${plain}.zst`] : [path];
}

function decodedTranscript(path: string, body: ReadableStream<Uint8Array>) {
  if (!path.endsWith(".jsonl.zst")) return body;
  // Bun supports streaming zstd; DOM typings still list browser-only formats.
  const ZstdStream = DecompressionStream as unknown as new (
    format: "zstd",
  ) => ReadableWritablePair<Uint8Array, Uint8Array>;
  return body.pipeThrough(new ZstdStream("zstd"));
}

export function transcriptText(path: string, body: ReadableStream<Uint8Array>) {
  return new Response(decodedTranscript(path, body)).text();
}

/** Stop decoding when the caller's prefix is complete. */
export async function transcriptPrefix(
  path: string,
  body: ReadableStream<Uint8Array>,
  byteLimit: number,
) {
  const reader = decodedTranscript(path, body).getReader();
  const chunks: Uint8Array[] = [];
  const limit = Math.max(1, Math.floor(byteLimit));
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, limit - size);
      chunks.push(chunk);
      size += chunk.length;
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
