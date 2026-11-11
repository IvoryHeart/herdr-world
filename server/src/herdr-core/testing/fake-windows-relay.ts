/**
 * Stands in for `ssh <host> powershell.exe … <relay>` in tests: copies raw
 * bytes between stdio and one fake named pipe (a Unix socket), and exits like
 * the relay script does. Run with `bun fake-windows-relay.ts`.
 */
import { createConnection } from "node:net";

const socket = process.env.FAKE_PIPE_SOCKET;
if (!socket) {
  process.stderr.write("no such pipe\n");
  process.exit(5);
}
const pipe = createConnection(socket);
const finish = (code: number) =>
  process.stdout.write(new Uint8Array(0), () => process.exit(code));
pipe.on("error", () => finish(5));
pipe.on("close", () => finish(0));
pipe.on("data", (bytes) => {
  if (!process.stdout.write(bytes)) {
    pipe.pause();
    process.stdout.once("drain", () => pipe.resume());
  }
});
process.stdin.on("data", (bytes) => {
  if (!pipe.write(bytes)) {
    process.stdin.pause();
    pipe.once("drain", () => process.stdin.resume());
  }
});
// Duplex pipes cannot half-close: stdin ending ends the relay.
process.stdin.on("end", () => {
  pipe.destroy();
  finish(0);
});
