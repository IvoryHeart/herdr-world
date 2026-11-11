import { expect, test } from "bun:test";
import { copyFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { coreHarnessNames } from "./harness";
import { harnessSpec } from "../agent/harness-readiness";
import { launchCore, createCoreRoom } from "./operations";
import { deliverCore } from "./delivery";
import { coreRecipientToken } from "./recipient";
import { connectedLive, until } from "./testing/live-world";
import { ScratchCore, scratchCoreBinary } from "./testing/scratch-core";

// A native, credential-free OSC 7501 stand-in, NOT a certification of the
// vendor harnesses. Each name exercises launch/status/foreground/delivery
// against the latest actual core. Transcript formats have separate fixtures.
const PROGRAM = `#include <stdio.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
  const char *app = strrchr(argv[0], '/'); app = app ? app+1 : argv[0];
  setvbuf(stdout, NULL, _IONBF, 0);
  printf("\\033]7501;state=idle:app=%s\\033\\\\", app);
  char line[4096];
  while (fgets(line, sizeof(line), stdin)) {
    printf("\\033]7501;state=working:app=%s\\033\\\\", app);
    usleep(100000);
    printf("\\033]7501;state=%s:app=%s\\033\\\\", strncmp(line,"question",8)==0 ? "blocked" : "idle", app);
  }
  return 0;
}`;

const bin = scratchCoreBinary();
for (const name of coreHarnessNames())
  test.skipIf(!bin || !Bun.which("cc"))(
    `${name}: launch, native status and core delivery in isolation`,
    async () => {
      const core = new ScratchCore(bin!);
      let w: Awaited<ReturnType<typeof connectedLive>> | undefined;
      try {
        const source = join(core.root, "probe.c"),
          executable = join(core.root, "probe");
        writeFileSync(source, PROGRAM);
        const compile = Bun.spawnSync(["cc", source, "-o", executable]);
        expect(compile.exitCode).toBe(0);
        await core.start();
        w = await connectedLive(core.stateDir);
        const room = await createCoreRoom(w.lease(), w.topology, "Harnesses");
        const elapsed: number[] = [];
        {
          const path = join(core.root, harnessSpec(name).binary);
          copyFileSync(executable, path);
          const result = await launchCore(
            w.lease(),
            {
              workspaceId: room.workspace_id,
              kind: name,
              label: name,
              text: "",
            },
            { topology: w.topology, resolveExecutable: async () => path },
          );
          expect({ harness: name, ...result }).toMatchObject({
            status: "started",
          });
          if (result.status !== "started") throw new Error("launch failed");
          const address = result.terminal_id;
          await until(
            () =>
              !!w!.record(address)?.foreground &&
              w!.record(address)?.reported === true,
          );
          const token = coreRecipientToken(
            w.lease().runtime.core.epoch!.coreId,
            w.record(address),
            w.lease().runtime.core.occupancy(address),
          )!;
          const start = performance.now();
          expect(
            await deliverCore(w.lease(), address, token, {
              kind: "message",
              text: "question",
            }),
          ).toMatchObject({ status: "sent" });
          await until(
            () =>
              (w!.record(address)?.status as { state?: string })?.state ===
              "blocked",
          );
          const rows = await w.lease().runtime.operations.listTerminals();
          expect(rows.panes).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                pane_id: address,
                agent: name,
                agent_status: "blocked",
              }),
            ]),
          );
          expect(
            await deliverCore(w.lease(), address, token, {
              kind: "answer",
              text: "finish",
            }),
          ).toMatchObject({ status: "sent" });
          await until(
            () =>
              (w!.record(address)?.status as { state?: string })?.state ===
              "idle",
          );
          const native = JSON.parse(await core.hc("get", "--json", address));
          expect(native.status.state).toBe("idle");
          expect(native.labels["herdr.space"]).toBeTruthy();
          expect(native.labels["herdr.tab"]).toBeTruthy();
          expect(
            (await w.lease().runtime.operations.listTerminals()).panes,
          ).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                pane_id: address,
                agent_status: "done",
              }),
            ]),
          );
          elapsed.push(performance.now() - start);
          await core.hc("kill", address);
        }
        elapsed.sort((a, b) => a - b);
        console.log(
          `${name} core message→blocked→answer→done: n=${elapsed.length}, median=${elapsed[Math.floor(elapsed.length / 2)]!.toFixed(0)}ms, max=${elapsed.at(-1)!.toFixed(0)}ms (includes core quiet/started waits)`,
        );
      } finally {
        if (w) {
          await w.stop();
          rmSync(w.root, { recursive: true, force: true });
        }
        await core.dispose();
      }
    },
    120_000,
  );
