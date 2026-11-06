import assert from "node:assert/strict";
import { readdir, readFile, readlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export async function ownsCheckerPort(pid, port) {
  if (process.platform === "linux") {
    const descriptors = await readdir(`/proc/${pid}/fd`);
    const sockets = new Set(
      await Promise.all(
        descriptors.map(async (descriptor) => {
          try {
            return (await readlink(`/proc/${pid}/fd/${descriptor}`)).match(
              /^socket:\[(\d+)\]$/,
            )?.[1];
          } catch (error) {
            if (error.code === "ENOENT") return undefined;
            throw error;
          }
        }),
      ),
    );
    for (const family of ["tcp", "tcp6"]) {
      const table = await readFile(`/proc/${pid}/net/${family}`, "utf8");
      for (const line of table.split("\n").slice(1)) {
        const fields = line.trim().split(/\s+/);
        if (
          fields[3] === "0A" &&
          fields[1]
            ?.toUpperCase()
            .endsWith(`:${port.toString(16).toUpperCase().padStart(4, "0")}`) &&
          sockets.has(fields[9])
        )
          return true;
      }
    }
    return false;
  }
  if (process.platform === "darwin") {
    const result = spawnSync(
      "lsof",
      ["-nP", "-a", "-p", String(pid), `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"],
      { encoding: "utf8" },
    );
    if (result.error) throw result.error;
    return result.status === 0 && result.stdout.split("\n").includes(`p${pid}`);
  }
  throw new Error("Checker ownership probing requires Linux or macOS");
}

/**
 * Wait until the verified daemon itself listens on the port. Another process
 * can hold it until the daemon's own bind fails, and that failure ends this
 * probe (its launcher then starts the checker on another port); until then a
 * foreign listener means "not ready yet", never "ready".
 */
export async function waitForOwnership(
  pid,
  port,
  deadline,
  owns = ownsCheckerPort,
  pause = () => new Promise((resolve) => setTimeout(resolve, 50)),
) {
  while (!(await owns(pid, port))) {
    if (Date.now() >= deadline)
      throw new Error("Checker listener is not owned by the verified daemon");
    await pause();
  }
}

async function ready(port, pid) {
  const require = createRequire(
    new URL("../tools/quint/package.json", import.meta.url),
  );
  const grpc = require("@grpc/grpc-js");
  const proto = require("@grpc/proto-loader");
  const definition = proto.loadSync(
    require.resolve("@informalsystems/quint/dist/src/reflection.proto"),
    {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    },
  );
  const descriptor = grpc.loadPackageDefinition(definition);
  const client = new descriptor.grpc.reflection.v1alpha.ServerReflection(
    `127.0.0.1:${port}`,
    grpc.credentials.createInsecure(),
  );
  let call;
  const deadline = Date.now() + 30_000;
  try {
    await waitForOwnership(pid, port, deadline);
    await new Promise((resolve, reject) =>
      client.waitForReady(deadline, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
    const response = await new Promise((resolve, reject) => {
      call = client.ServerReflectionInfo({ deadline });
      call.once("data", resolve);
      call.once("error", reject);
      call.write({ file_containing_symbol: "shai.cmdExecutor.CmdExecutor" });
    });
    assert(
      response.file_descriptor_response?.file_descriptor_proto?.length > 0,
      "Checker reflection protocol is unavailable",
    );
    assert(
      await ownsCheckerPort(pid, port),
      "Checker listener is not owned by the verified daemon",
    );
  } finally {
    call?.cancel();
    client.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]);
  const pid = Number(process.argv[3]);
  assert(
    Number.isInteger(port) &&
      port > 0 &&
      port <= 65535 &&
      Number.isInteger(pid) &&
      pid > 0,
  );
  await ready(port, pid);
}
