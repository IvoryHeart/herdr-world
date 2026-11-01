import { agentAddress } from "../../../../../shared/groups";
import { basename, dirname, join } from "node:path";

/** Synthetic data only, shared by browser checks and five-view screenshot capture. */
export async function groupsBrowserServer(directory: string) {
  // The fixture host runs in Bun; do not pull the RPC/index graph into the browser TypeScript project.
  const { handleWorldRpc } = await import(
    join(import.meta.dir, "../../../../../server/src/rpc/world.ts")
  );
  const { BoardStore } = await import(
    join(import.meta.dir, "../../../../../server/src/world/board-store.ts")
  );
  const board = new BoardStore(join(directory, "board.json"));
  const ref = (name: string) => agentAddress("connection-a", name);
  board.patch([
    {
      op: "group.create",
      id: "chat",
      kind: "pod",
      name: "Chat",
      attrs: { queue: ["Review the fixes", "Ship the batch"] },
      members: [
        { ref: ref("a"), roles: ["lead", "builder"] },
        { ref: ref("reviewer"), roles: ["reviewer"] },
        { ref: ref("away"), roles: ["builder"] },
        { ref: ref("duplicate"), roles: ["builder"] },
      ],
    },
    {
      op: "group.create",
      id: "town",
      kind: "pod",
      name: "Town",
      members: [
        { ref: ref("b"), roles: ["lead", "builder"] },
        { ref: ref("reviewer"), roles: ["reviewer"] },
      ],
    },
    {
      op: "group.create",
      id: "pair",
      kind: "team",
      name: "Review pair",
      members: [0, 2].map((index) => ({
        ref: {
          connection_id: "connection-a",
          terminal_id: `terminal-${index}`,
        },
        roles: [],
      })),
    },
  ]);
  const names = ["a", "b", "reviewer", "duplicate", "duplicate"];
  const panes = names.map((_name, index) => ({
    pane_id: `pane-${index}`,
    terminal_id: `terminal-${index}`,
    tab_id: `tab-${index}`,
    workspace_id: "room-1",
    agent: "codex",
    agent_status: index === 0 ? "blocked" : "working",
  }));
  const payload = {
    revision: 1,
    observed_at: Date.now(),
    connections: [
      {
        connection_id: "connection-a",
        label: "Example host",
        source: "local",
        is_default: true,
        state: "ready",
        generation: 1,
        snapshot_generation: 1,
        stale: false,
        actionable: true,
        snapshot: {
          coverage: {
            workspaces: 1,
            tabs: 5,
            panes: 5,
            agent_panes: 5,
            status: { working: 4, idle: 0, blocked: 1, done: 0, unknown: 0 },
            by_workspace: [
              {
                workspace_id: "room-1",
                tabs: 5,
                panes: 5,
                agent_panes: 5,
                status: {
                  working: 4,
                  idle: 0,
                  blocked: 1,
                  done: 0,
                  unknown: 0,
                },
              },
            ],
          },
          workspaces: [{ workspace_id: "room-1", label: "Workshop" }],
          tabs: panes.map((pane, index) => ({
            tab_id: pane.tab_id,
            workspace_id: "room-1",
            label: `Desk ${index + 1}`,
          })),
          panes,
          agents: names.map((name, index) => ({
            pane_id: `pane-${index}`,
            terminal_id: `terminal-${index}`,
            agent: "codex",
            name,
          })),
        },
      },
    ],
  };
  const source = {
    observedAt: Date.now(),
    refreshing: false,
    sources: [
      {
        id: "github",
        label: "GitHub",
        enabled: true,
        state: "connected",
        detail: "",
        checkedAt: Date.now(),
        lastSuccessAt: Date.now(),
        itemCount: 3,
        config: { kind: "github", mergedDays: 7 },
      },
    ],
    items: [1, 2, 3].map((number) => ({
      key: `github:pr:example-org/example#${number}`,
      source: "github",
      kind: "pull_request",
      ref: `example-org/example#${number}`,
      title: `Synthetic change ${number}`,
      url: `https://example.invalid/pull/${number}`,
      lane: "review",
      status: "open",
      roles: ["reviewer"],
      updatedAt: Date.now(),
      number,
      repo: "example-org/example",
      checks: "pending",
      review: "review_required",
    })),
    links: [1, 2, 3].map((number) => ({
      connectionId: "connection-a",
      generation: 1,
      paneId: "pane-0",
      sessionFingerprint: null,
      itemKey: `github:pr:example-org/example#${number}`,
      via: "branch",
    })),
    actions: [],
  };
  const assets = new Map<string, Blob>();
  const result = Promise.withResolvers<string[]>();
  const requested = Promise.withResolvers<void>();
  let heldWrite: ReturnType<typeof Promise.withResolvers<void>> | null = null;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/") {
        requested.resolve();
        return new Response(
          '<head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/GroupsWindow.browser.css"></head><body><div id="root"></div><script type="module" src="/GroupsWindow.browser.js"></script></body>',
          { headers: { "content-type": "text/html" } },
        );
      }
      if (path === "/result") {
        result.resolve((await request.json()) as string[]);
        return new Response("ok");
      }
      if (path === "/api/world/sources") return Response.json(source);
      if (path === "/board") return Response.json(board.get());
      if (path === "/compete") {
        board.patch(await request.json());
        return Response.json(board.get());
      }
      if (path === "/hold-write") {
        heldWrite = Promise.withResolvers<void>();
        return new Response("ok");
      }
      if (path === "/release-write") {
        heldWrite?.resolve();
        heldWrite = null;
        return new Response("ok");
      }
      if (path === "/replace-agent") {
        const { name } = await request.json();
        payload.connections[0]!.snapshot.agents[1]!.name = name;
        payload.revision++;
        return Response.json(payload);
      }
      if (path === "/advance") {
        board.patch([
          { op: "group.set_attrs", id: "town", name: "Town updated" },
        ]);
        return Response.json(board.get());
      }
      if (path === "/snapshot") return Response.json(payload);
      if (path === "/rpc") {
        const { method, params } = (await request.json()) as {
          method: string;
          params: unknown;
        };
        if (method === "world.snapshot") return Response.json(payload);
        if (method === "world.board.patch") await heldWrite?.promise;
        let response: unknown;
        await handleWorldRpc({
          method,
          params,
          id: "groups-browser",
          requestIsCurrent: () => !request.signal.aborted,
          services: {
            board: () => board,
            publishBoardChanged: () => {},
            bindBoardRecipients: async () => {},
            logger: { warn: () => {} },
          },
          sendReply: (reply: { result: unknown }) => {
            response = reply.result;
            return true;
          },
          sendError: (_method: string, error: unknown) => {
            response = { error: String(error) };
          },
        } as never);
        return Response.json(response);
      }
      const asset = assets.get(path);
      return asset
        ? new Response(asset)
        : new Response("not found", { status: 404 });
    },
  });
  try {
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, "../GroupsWindow.browser.tsx")],
      outdir: directory,
      target: "browser",
      plugins: [
        {
          name: "raw-svg",
          setup(build) {
            build.onResolve(
              { filter: /\.svg\?raw$/ },
              ({ path, importer }) => ({
                path: Bun.resolveSync(path.slice(0, -4), dirname(importer)),
                namespace: "raw-svg",
              }),
            );
            build.onLoad(
              { filter: /.*/, namespace: "raw-svg" },
              async ({ path }) => ({
                contents: await Bun.file(path).text(),
                loader: "text",
              }),
            );
          },
        },
      ],
    });
    if (!build.success) throw new Error(build.logs.map(String).join("\n"));
    for (const output of build.outputs)
      assets.set(`/${basename(output.path)}`, output);
  } catch (error) {
    server.stop(true);
    throw error;
  }
  return {
    server,
    board,
    requested: requested.promise,
    result: result.promise,
  };
}
