import { expect, test } from "bun:test";
import {
  createConnectionReplyPublisher,
  CONNECTION_CHANGED_DURING_REQUEST,
} from "../connections/protocol";
import type { ConnectionRpcContext } from "./context";
import { handleLauncherRpc } from "./launcher";
import { probeLauncher } from "./launcher-probe";

function fixture() {
  let current = true;
  let host = "probe.example";
  let hostReads = 0;
  const messages: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const publisher = createConnectionReplyPublisher({
    connectionId: "host-a",
    generation: 7,
    requestId: "probe",
    isCurrent: () => current,
    send: (payload) => {
      messages.push(JSON.parse(payload));
      return true;
    },
  });
  const rpc = {
    method: "launcher.readiness",
    id: "probe",
    params: {},
    services: {},
    requestIsCurrent: () => current,
    connection: {
      sshHost: () => {
        hostReads++;
        return host;
      },
      remotePlatform: "linux",
      herdr: {
        call: async (method: string) => {
          calls.push(method);
          return { manifests: [{ agent: "codex" }] };
        },
      },
    },
    sendReply: publisher.send,
    sendError: (context: string, error: Error) =>
      publisher.send(
        { id: "probe", error: { message: error.message } },
        context,
      ),
  } as unknown as ConnectionRpcContext;
  return {
    rpc,
    messages,
    calls,
    retire: () => {
      current = false;
    },
    replaceHost: () => {
      host = "replacement.example";
    },
    hostReads: () => hostReads,
  };
}

const found = {
  code: 0,
  stdout: "@@kind codex\n@@found\nLogged in using ChatGPT\n@@exit 0\n@@end\n",
  stderr: "",
};

test("probe uses the captured host across manifest discovery", async () => {
  const f = fixture();
  const manifests = Promise.withResolvers<unknown>();
  f.rpc.connection.herdr.call = async () => manifests.promise;
  const argv: string[][] = [];
  const pending = probeLauncher(f.rpc, false, async (args) => {
    argv.push(args);
    return found;
  });
  f.replaceHost();
  manifests.resolve({ manifests: [{ agent: "codex" }] });
  const result = await pending;
  expect(result.readiness[0]?.logged_in).toBe(true);
  expect(argv).toHaveLength(1);
  expect(argv[0]).toContain("probe.example");
  expect(JSON.stringify(argv)).not.toContain("replacement.example");
  expect(f.hostReads()).toBe(1);
});

test("retirement during discovery prevents process work", async () => {
  const f = fixture();
  f.rpc.connection.herdr.call = async () => {
    f.retire();
    return { manifests: [{ agent: "codex" }] };
  };
  let ran = false;
  await expect(
    probeLauncher(f.rpc, false, async () => {
      ran = true;
      return found;
    }),
  ).rejects.toThrow(CONNECTION_CHANGED_DURING_REQUEST);
  expect(ran).toBe(false);
});

test("retirement during the process rejects the completed observation", async () => {
  const f = fixture();
  const entered = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<typeof found>();
  const pending = probeLauncher(f.rpc, false, async () => {
    entered.resolve();
    return finish.promise;
  });
  await entered.promise;
  f.retire();
  f.replaceHost();
  finish.resolve(found);
  await expect(pending).rejects.toThrow(CONNECTION_CHANGED_DURING_REQUEST);
  expect(f.hostReads()).toBe(1);
});

test("readiness and catalog RPCs retain captured identity and Windows unknown", async () => {
  for (const method of ["launcher.readiness", "launcher.catalog"]) {
    const f = fixture();
    f.rpc.method = method;
    f.rpc.connection.remotePlatform = "windows";
    await handleLauncherRpc(f.rpc);
    expect(f.messages[0]).toMatchObject({
      connection_id: "host-a",
      connection_generation: 7,
      result: {
        readiness: [
          {
            kind: "codex",
            installed: null,
            logged_in: null,
            probe: { state: "unsupported" },
          },
        ],
      },
    });
    expect(f.calls).toEqual(["server.agent_manifests"]);
  }
});

test("actual RPC rejects a retired result with its original envelope", async () => {
  for (const method of ["launcher.readiness", "launcher.catalog"]) {
    const f = fixture();
    f.rpc.method = method;
    f.rpc.connection.herdr.call = async () => {
      f.retire();
      return { manifests: [{ agent: "codex" }] };
    };
    await handleLauncherRpc(f.rpc);
    expect(f.messages).toEqual([
      {
        connection_id: "host-a",
        connection_generation: 7,
        id: "probe",
        error: { message: CONNECTION_CHANGED_DURING_REQUEST },
      },
    ]);
  }
});

test("catalog retirement during pane discovery prevents both process probes", async () => {
  const f = fixture();
  f.rpc.params = { workspace_id: "example-workspace" };
  f.rpc.connection.herdr.call = async (method: string) => {
    if (method === "server.agent_manifests")
      return { manifests: [{ agent: "codex" }] };
    f.retire();
    return { panes: [] };
  };
  let ran = false;
  await expect(
    probeLauncher(f.rpc, true, async () => {
      ran = true;
      return found;
    }),
  ).rejects.toThrow(CONNECTION_CHANGED_DURING_REQUEST);
  expect(ran).toBe(false);
});
