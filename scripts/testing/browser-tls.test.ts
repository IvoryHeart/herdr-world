import { expect, test } from "bun:test";
import { createHash, X509Certificate } from "node:crypto";
import { createServer, connect } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserOriginProxy, createBrowserTLS } from "./browser-tls";

test("the fixture certificate pin names only its generated public key", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-tls-control-"));
  try {
    const tls = await createBrowserTLS(root);
    if (!Bun.which("openssl")) {
      expect(tls).toBeUndefined();
      return;
    }
    const certificate = new X509Certificate(tls!.cert);
    expect(certificate.checkIP("127.0.0.1")).toBe("127.0.0.1");
    expect(certificate.checkHost("hostile.vscode-cdn.net")).toBe(
      "hostile.vscode-cdn.net",
    );
    expect(certificate.checkHost("unrelated.example")).toBeUndefined();
    expect(tls!.fingerprint).toBe(
      createHash("sha256")
        .update(certificate.publicKey.export({ type: "spki", format: "der" }))
        .digest("base64"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the context proxy tunnels only its declared origin and closes its own sockets", async () => {
  let connections = 0;
  const upstream = createServer((socket) => {
    connections++;
    socket.on("error", () => {});
    socket.on("data", (data) => socket.end(`echo:${data}`));
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const port = (upstream.address() as { port: number }).port;
  const proxy = await browserOriginProxy("fixture.example:443", port);
  const request = (authority: string, tunnel: boolean) =>
    new Promise<string>((resolve, reject) => {
      const socket = connect({
        host: "127.0.0.1",
        port: Number(new URL(proxy.url).port),
      });
      let received = "",
        sent = false;
      socket.on("error", reject);
      socket.on("connect", () =>
        socket.write(
          `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`,
        ),
      );
      socket.on("data", (chunk) => {
        received += chunk.toString();
        if (
          tunnel &&
          !sent &&
          received.includes("200 Connection Established\r\n\r\n")
        ) {
          sent = true;
          socket.write("hello");
        }
      });
      socket.on("end", () => {
        socket.destroy();
        resolve(received);
      });
    });
  try {
    expect(await request("fixture.example:443", true)).toContain("echo:hello");
    expect(connections).toBe(1);
    expect(await request("other.example:443", false)).toContain(
      "403 Forbidden",
    );
    expect(connections).toBe(1);
  } finally {
    await proxy.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
