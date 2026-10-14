import { expect, test } from "bun:test";
import { creationFixture } from "./creation-fixture";

test("existing production creation pipeline retains and attaches a qualified source before dispatch", async () => {
  const f = creationFixture();
  let pending: Promise<unknown> | undefined;
  let off = () => {};
  try {
    const demanded = Promise.withResolvers<void>();
    off = f.subjects.subscribeCreationSources(() => {
      if (f.subjects.creationSources().length) demanded.resolve();
    });
    pending = f.subjects.store.createQualifiedTab(f.target(0), "shared");
    await demanded.promise;
    expect(f.calls).toHaveLength(0);
    const attachment = f.attach(0);
    f.ready(attachment);
    await f.entered[0]!.promise;
    expect(f.calls[0]!.generation).toBe(1);
    expect(f.calls[0]!.params.browser_source).toEqual({
      workspace_id: "shared",
      tab_id: "shared-tab",
      pane_id: "shared-pane",
      terminal_id: "shared-terminal",
    });
    f.reply(0);
    expect(await pending).toEqual(f.result());
    expect(f.subjects.creationSources()).toHaveLength(0);
  } finally {
    off();
    f.retire(0);
    if (pending) await pending.catch(() => {});
    f.restore();
  }
});
