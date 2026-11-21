/**
 * A stand-in for `code-tunnel serve-web` in tests: the same flags, a
 * connection-token cookie check, upstream cookies on `Path=/` and an echo
 * WebSocket. `FAKE_IDE_DOWNLOADS=<n>` answers 202 to the first n requests,
 * as VS Code's CLI does while it downloads its web server. A socket whose
 * first message is VS Code's `auth` control message gets `auth:ok`, or
 * `auth:mismatch` when it lacks the connection token, as the real server
 * checks it.
 *
 * Given code-server's `--socket` instead, it serves at its root with no
 * token, and answers `/proxy/<port>` and `/absproxy/<port>` (HTTP and
 * WebSocket) as code-server's port proxies would, whatever its flags, so a
 * test proves World itself never forwards them.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("code 1.99.0 (commit 0000000000000000000000000000000000000000)");
  process.exit(0);
}
const flag = (name: string) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const codeServer = flag("--socket") !== undefined;
const socketPath = flag("--socket-path") ?? flag("--socket");
const tokenFile = flag("--connection-token-file");
const base = flag("--server-base-path") ?? "";
if (!socketPath || (!tokenFile && !codeServer)) {
  console.error("error: missing --socket-path or --connection-token-file");
  process.exit(2);
}
if (process.env.FAKE_IDE_FAIL) {
  console.error("error: the fake IDE was told to fail");
  process.exit(3);
}
const token = tokenFile ? readFileSync(tokenFile, "utf8").trim() : null;
let downloads = Number(process.env.FAKE_IDE_DOWNLOADS ?? 0);

function cookies(req: Request) {
  return Object.fromEntries(
    (req.headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([name]) => name),
  ) as Record<string, string>;
}

Bun.serve({
  unix: socketPath,
  fetch(req, server) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(base))
      return new Response("outside", { status: 404 });
    if (downloads > 0) {
      downloads--;
      return new Response("downloading", { status: 202 });
    }
    const jar = cookies(req);
    if (token && jar["vscode-tkn"] !== token)
      return new Response("forbidden", { status: 403 });
    const rest = url.pathname.slice(base.length);
    if (codeServer && /^\/(abs)?proxy\//.test(rest)) {
      if (server.upgrade(req, { data: undefined })) return undefined;
      return new Response("proxied to another local service");
    }
    if (rest === "/ws") {
      if (server.upgrade(req, { data: undefined })) return undefined;
      return new Response("upgrade failed", { status: 400 });
    }
    if (rest === "/away")
      return new Response(null, {
        status: 302,
        headers: { location: "http://elsewhere.example/" },
      });
    if (rest === "/inside")
      return new Response(null, {
        status: 302,
        headers: { location: `${base}/` },
      });
    const headers = new Headers({ "content-type": "application/json" });
    if (token)
      headers.append(
        "set-cookie",
        `vscode-tkn=${token}; Path=/; SameSite=Strict`,
      );
    headers.append("set-cookie", `vscode-secret-key-path=${base}/mint; Path=/`);
    headers.append("set-cookie", "world_session=shadow; Path=/");
    headers.set("service-worker-allowed", "/");
    return new Response(
      JSON.stringify({
        path: url.pathname,
        host: req.headers.get("host"),
        cookies: Object.keys(jar).sort(),
        authorization: req.headers.get("authorization"),
      }),
      { headers },
    );
  },
  websocket: {
    message(ws, message) {
      if (typeof message !== "string" && message[0] === 2) {
        const auth = JSON.parse(new TextDecoder().decode(message.subarray(13)));
        if (auth.type === "auth") {
          ws.send(token && auth.auth !== token ? "auth:mismatch" : "auth:ok");
          return;
        }
      }
      ws.send(`echo:${message}`);
    },
  },
});
console.log(`listening on ${socketPath}`);
