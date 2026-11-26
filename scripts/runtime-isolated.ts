import {
  assertIsolation,
  controlOperation,
  kitEnv,
  paths,
  readKit,
  removeUninitializedKit,
  startKit,
  stopKit,
} from "./runtime-isolated-kit";
import { selfTest } from "./runtime-isolated-self-test";

async function main(args: string[]) {
  const [action, ...rest] = args;
  let name = "check";
  if (rest[0] === "--name" && rest[1]) {
    name = rest[1];
    rest.splice(0, 2);
  }
  if (
    rest.length ||
    !["start", "status", "stop", "self-test", "exec"].includes(action)
  )
    throw new Error(
      "Usage: bun run runtime:isolated start|status|stop|self-test [--name <n>]\n       bun run runtime:isolated exec [--name <n>] -- <command> [args...]",
    );
  if (action === "self-test") {
    await selfTest(name);
    return;
  }
  if (action === "stop" && removeUninitializedKit(name)) {
    console.log(
      JSON.stringify({
        name,
        state: "stopped",
        removed_processes: 0,
        folder_removed: true,
      }),
    );
    return;
  }
  const kit = action === "start" ? await startKit(name) : readKit(name);
  if (!kit) {
    console.log(JSON.stringify({ name, state: "stopped" }));
    return;
  }
  if (action === "stop") {
    console.log(
      JSON.stringify({
        name,
        state: "stopped",
        ...(await stopKit(kit)),
        folder_removed: true,
      }),
    );
    return;
  }
  if (!kit.port)
    throw new Error("start was interrupted; use stop before starting again");
  const isolation = await assertIsolation(kit);
  console.log(
    JSON.stringify(
      {
        name,
        state: "running",
        url: `http://127.0.0.1:${kit.port}`,
        session: kit.session,
        ...paths(kit),
        ...isolation,
        versions: kit.versions,
        scratch: {
          claude: kitEnv(kit).CLAUDE_CONFIG_DIR,
          codex: kitEnv(kit).CODEX_HOME,
        },
        login: `bun run runtime:isolated exec --name ${name} -- cat ${paths(kit).world}/auth-token`,
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  try {
    // Exec is intentionally explicit: the command inherits only the kit env.
    const original = process.argv.slice(2);
    if (original[0] === "exec") {
      const args = original.slice(1);
      let name = "check";
      if (args[0] === "--name") {
        args.shift();
        name = args.shift()!;
      }
      if (args.shift() !== "--" || !args.length)
        throw new Error("exec requires -- <command> [args...]");
      const child = await controlOperation(async () => {
        const kit = readKit(name);
        if (!kit?.port)
          throw new Error("kit is stopped or start was interrupted");
        await assertIsolation(kit);
        // Release the control lock after launch so stop can end this process.
        return Bun.spawn(args, {
          env: kitEnv(kit),
          cwd: `${kit.root}/scratch`,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        });
      });
      process.exitCode = await child.exited;
    } else await controlOperation(() => main(original));
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
}
