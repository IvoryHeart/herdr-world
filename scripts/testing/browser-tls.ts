import { createHash, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer, connect, type Socket } from "node:net";

/** A disposable certificate, trusted by its public key for this browser job only. */
export async function createBrowserTLS(directory: string) {
  const openssl = Bun.which("openssl");
  if (!openssl) return undefined;
  const key = join(directory, "fixture-key.pem"),
    cert = join(directory, "fixture-cert.pem");
  const child = Bun.spawn(
    [
      openssl,
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1,DNS:hostile.vscode-cdn.net",
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  if ((await child.exited) !== 0)
    throw new Error("Synthetic browser TLS certificate generation failed");
  const contents = {
    key: await readFile(key, "utf8"),
    cert: await readFile(cert, "utf8"),
  };
  const spki = new X509Certificate(contents.cert).publicKey.export({
    type: "spki",
    format: "der",
  });
  return {
    ...contents,
    fingerprint: createHash("sha256").update(spki).digest("base64"),
  };
}

/** Route only the declared synthetic origin; TLS and browser origin checks stay native. */
export async function browserOriginProxy(authority: string, port: number) {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.setTimeout(10_000, () => socket.destroy());
    let header = Buffer.alloc(0);
    const read = (chunk: Buffer) => {
      header = Buffer.concat([header, chunk]);
      if (header.length > 8192) {
        socket.destroy();
        return;
      }
      const end = header.indexOf("\r\n\r\n");
      if (end < 0) return;
      socket.off("data", read);
      if (
        header.subarray(0, end).toString().split("\r\n")[0] !==
        `CONNECT ${authority} HTTP/1.1`
      ) {
        socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      const upstream = connect({ host: "127.0.0.1", port });
      sockets.add(upstream);
      upstream.on("close", () => sockets.delete(upstream));
      upstream.on("error", () => socket.destroy());
      socket.on("close", () => upstream.destroy());
      upstream.on("connect", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        const remaining = header.subarray(end + 4);
        if (remaining.length) upstream.write(remaining);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
    };
    socket.on("data", read);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Synthetic proxy did not bind");
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export async function sharedBrowserTLS(): Promise<{
  key: string;
  cert: string;
}> {
  if (!process.env.HERDR_TEST_BROWSER)
    throw new Error("TLS browser fixtures require the browser runner");
  const response = await fetch(process.env.HERDR_TEST_BROWSER, {
    method: "POST",
    headers: {
      authorization: process.env.HERDR_TEST_BROWSER_TOKEN!,
      "content-type": "application/json",
    },
    body: JSON.stringify({ tls: true }),
  });
  if (!response.ok) throw new Error("Synthetic browser TLS unavailable");
  return response.json();
}
