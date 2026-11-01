import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import * as net from "node:net";
import { join } from "node:path";

/** Keep fake forwarding in the test process while retaining real killable SSH PIDs. */
export function createInProcessSsh(bin: string, state: string, home: string) {
  const curl = Bun.which("curl");
  if (!curl)
    throw new Error(
      "The SSH process fixture requires curl for its local Unix transport",
    );
  const path = join(state, "ssh-http.sock");
  const cleanups = new Set<() => Promise<void>>();
  let closing = false;
  let stoppedBroker: Promise<void> | undefined;
  const broker = Bun.serve({
    unix: path,
    async fetch(request) {
      const parts = (await request.text()).split("\0");
      if (closing) return new Response("", { status: 503 });
      parts.pop();
      const pid = Number(parts.shift());
      if (!Number.isSafeInteger(pid) || pid <= 0)
        throw new Error("Invalid fake SSH process packet");
      const args = parts;
      rmSync(join(state, `request-${pid}`), { force: true });
      const separator = args.lastIndexOf("--");
      const destination = separator >= 0 ? args[separator + 1]! : "unknown";
      if (!args.includes("-L") && (args.at(-1) || "").includes("printf %s"))
        return new Response(home + "\n");
      if (
        !args.includes("-L") &&
        (args.at(-1) || "").includes("herdr-world-uploads-")
      )
        return new Response("");
      appendFileSync(
        join(state, destination + ".attempts"),
        String(pid) + "\n",
      );
      if (destination === "auth-fail") return new Response("", { status: 403 });
      const forwards: { local: string; remote: string }[] = [];
      for (let index = 0; index < args.length; index++) {
        if (args[index] !== "-L") continue;
        const spec = args[index + 1] || "";
        const colon = spec.indexOf(":");
        if (colon <= 0) throw new Error("Invalid forwarding fixture arguments");
        forwards.push({
          local: spec.slice(0, colon),
          remote: spec.slice(colon + 1),
        });
      }
      const servers: net.Server[] = [];
      const connections = new Set<net.Socket>();
      let stopped: Promise<void> | undefined;
      const stop = () =>
        (stopped ??= (async () => {
          for (const connection of connections) connection.destroy();
          await Promise.all(
            servers.map(
              (server) =>
                new Promise<void>((resolve) => server.close(() => resolve())),
            ),
          );
          for (const forward of forwards)
            rmSync(forward.local, { force: true });
          cleanups.delete(stop);
        })());
      cleanups.add(stop);
      try {
        for (const forward of forwards) {
          rmSync(forward.local, { force: true });
          const server = net.createServer((client) => {
            const upstream = net.createConnection(forward.remote);
            connections.add(client);
            connections.add(upstream);
            client.on("close", () => connections.delete(client));
            upstream.on("close", () => connections.delete(upstream));
            client.on("error", () => upstream.destroy());
            upstream.on("error", () => client.destroy());
            client.pipe(upstream).pipe(client);
          });
          await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(forward.local, resolve);
          });
          servers.push(server);
        }
        writeFileSync(
          join(state, destination + ".json"),
          JSON.stringify({ pid, forwards }),
        );
        request.signal.addEventListener(
          "abort",
          () => {
            void stop();
          },
          { once: true },
        );
        if (closing || request.signal.aborted) await stop();
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("ready\n"));
            },
            cancel: stop,
          }),
        );
      } catch (error) {
        await stop();
        throw error;
      }
    },
  });
  const executable = join(bin, "ssh");
  // exec preserves the fake SSH PID. Curl's disconnect is the event that tears
  // down only that PID's in-process sockets after SIGKILL or SIGTERM.
  writeFileSync(
    executable,
    `#!/bin/sh
request="$HERDR_WORLD_FAKE_SSH_STATE_DIR/request-$$"
printf '%s\\0' "$$" "$@" > "$request"
for argument do
  if [ "$argument" = auth-fail ]; then
    "$HERDR_WORLD_FAKE_SSH_CURL" -q -sS --noproxy '*' --unix-socket "$HERDR_WORLD_FAKE_SSH_BROKER" --data-binary "@$request" http://localhost/ssh >/dev/null
    printf '%s\n' 'Permission denied (publickey).' >&2
    exit 255
  fi
done
exec "$HERDR_WORLD_FAKE_SSH_CURL" -q -sSN --noproxy '*' --unix-socket "$HERDR_WORLD_FAKE_SSH_BROKER" --data-binary "@$request" http://localhost/ssh
`,
    { mode: 0o700 },
  );
  return {
    env: {
      HERDR_WORLD_FAKE_SSH_CURL: curl,
      HERDR_WORLD_FAKE_SSH_BROKER: path,
      HERDR_WORLD_FAKE_SSH_STATE_DIR: state,
    },
    stop: () =>
      (stoppedBroker ??= (async () => {
        closing = true;
        await broker.stop(true);
        await Promise.all([...cleanups].map((stop) => stop()));
      })()),
  };
}
