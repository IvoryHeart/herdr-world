import { describe, expect, test } from "bun:test";
import {
  codexDaemonProxyArgv,
  listCodexDaemonThreads,
} from "./codex-app-server";

const ID = "019f0000-1111-7222-8333-444455556666";
const thread = {
  id: ID,
  cwd: "/work/demo",
  createdAt: 1000,
  updatedAt: 1100,
  source: "vscode",
  parentThreadId: null,
  status: { type: "active", activeFlags: [] },
};

// A disposable protocol peer: only initialize and the read-only list method
// are accepted. No installed Codex, home directory, daemon or account is used.
function peer(pages: unknown[], mode = "normal") {
  return [
    process.execPath,
    "-e",
    `const pages = ${JSON.stringify(pages)};
const mode = ${JSON.stringify(mode)};
let page = 0;
let buffer = '';
for await (const chunk of Bun.stdin.stream()) {
  buffer += new TextDecoder().decode(chunk);
  let newline;
  while ((newline = buffer.indexOf('\\n')) !== -1) {
    const message = JSON.parse(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
    if (message.method === 'initialized') continue;
    if (mode === 'hang') continue;
    if (mode === 'malformed') { process.stdout.write('not json\\n'); continue; }
    if (mode === 'oversized') { process.stdout.write('x'.repeat(1024 * 1024 + 1)); continue; }
    if (mode === 'exit') process.exit(1);
    let result;
    if (message.method === 'initialize') result = {};
    else if (message.method === 'thread/list' &&
      message.params.cwd === '/work/demo' &&
      message.params.useStateDbOnly === true &&
      message.params.archived === false &&
      JSON.stringify(message.params.sourceKinds) === '["cli","vscode"]') {
      result = pages[Math.min(page++, pages.length - 1)];
    } else process.exit(2);
    process.stdout.write(JSON.stringify({method:'thread/status/changed',params:{}}) + '\\n');
    process.stdout.write(JSON.stringify({id:message.id,result}) + '\\n');
  }
}`,
  ];
}

describe("Codex daemon observation", () => {
  test("remote discovery uses the selected host's login environment and strict SSH policy", () => {
    const remote = codexDaemonProxyArgv("operator@example.com");
    expect(remote.slice(-3)).toEqual([
      "--",
      "operator@example.com",
      "bash -lc 'exec codex app-server proxy'",
    ]);
    expect(remote).toContain("BatchMode=yes");
    expect(remote).toContain("StrictHostKeyChecking=yes");
    expect(codexDaemonProxyArgv()).toEqual(["codex", "app-server", "proxy"]);
    expect(() => codexDaemonProxyArgv("-oProxyCommand=unsafe")).toThrow();
  });
  test("initializes, filters by cwd and pages without resuming or subscribing", async () => {
    const result = await listCodexDaemonThreads("/work/demo", {
      argv: peer([
        {
          data: [{ ...thread, status: { type: "notLoaded" } }],
          nextCursor: "next",
        },
        { data: [{ ...thread, id: ID.replace(/6$/, "7") }], nextCursor: null },
      ]),
    });
    expect(result).toEqual([
      {
        id: ID.replace(/6$/, "7"),
        cwd: "/work/demo",
        createdAt: 1000000,
        updatedAt: 1100000,
        status: "active",
        waiting: false,
      },
    ]);
  });

  test("keeps idle competitors and approval activity; excludes subagents", async () => {
    const result = await listCodexDaemonThreads("/work/demo", {
      argv: peer([
        {
          data: [
            { ...thread, status: { type: "idle" } },
            {
              ...thread,
              id: ID.replace(/6$/, "7"),
              status: { type: "active", activeFlags: ["waitingOnApproval"] },
            },
            {
              ...thread,
              id: ID.replace(/6$/, "8"),
              parentThreadId: ID,
              source: { subAgent: "review" },
            },
          ],
          nextCursor: null,
        },
      ]),
    });
    expect(result?.map(({ status, waiting }) => ({ status, waiting }))).toEqual(
      [
        { status: "idle", waiting: false },
        { status: "active", waiting: true },
      ],
    );
  });

  test.each([
    { data: [thread], nextCursor: "repeated" },
    { data: [thread, thread], nextCursor: null },
    { data: [{ ...thread, cwd: "/work/elsewhere" }], nextCursor: null },
    {
      data: [{ ...thread, status: { type: "newUnknownStatus" } }],
      nextCursor: null,
    },
    { data: [{ ...thread, updatedAt: "1100" }], nextCursor: null },
    { data: [thread] },
  ])("rejects incomplete or invalid evidence %#", async (page) => {
    expect(
      await listCodexDaemonThreads("/work/demo", { argv: peer([page]) }),
    ).toBeNull();
  });

  test.each(["malformed", "oversized", "exit", "hang"])(
    "fails closed on %s and tears down its proxy",
    async (mode) => {
      expect(
        await listCodexDaemonThreads("/work/demo", {
          argv: peer([], mode),
          timeoutMs: 150,
        }),
      ).toBeNull();
    },
  );

  test("missing proxy is unavailable, without starting a daemon", async () => {
    expect(
      await listCodexDaemonThreads("/work/demo", {
        argv: ["/does-not-exist/codex"],
      }),
    ).toBeNull();
  });
});
