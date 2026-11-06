import { expect, test } from "bun:test";
import { EMPTY_BIN, type BinState } from "../../../../shared/bin";
import { WorldBinStore } from "./binStore";
import type { BridgeControlMsg, ConnectionStatus } from "../../api";
function fixture() {
  let status: (s: ConnectionStatus) => void = () => {};
  let control: (s: BridgeControlMsg) => void = () => {};
  const requests: { method: string; resolve: (state: BinState) => void }[] = [];
  const store = new WorldBinStore(
    {
      call: (method) =>
        new Promise((resolve) => requests.push({ method, resolve })),
      onStatus: (listener) => {
        status = listener;
        return () => {};
      },
      onControl: (listener) => {
        control = listener;
        return () => {};
      },
    },
    () => 100,
  );
  return {
    store,
    requests,
    status: (s: ConnectionStatus) => status(s),
    control: (s: BridgeControlMsg) => control(s),
  };
}
test("late replies cannot replace a newer bin or a new service run", async () => {
  const f = fixture();
  const a = f.store.refresh(),
    b = f.store.refresh();
  f.requests[1]!.resolve({ ...EMPTY_BIN, epoch: "new", revision: 1 });
  await b;
  f.requests[0]!.resolve({ ...EMPTY_BIN, epoch: "old", revision: 20 });
  await a;
  expect(f.store.get().epoch).toBe("new");
  expect(f.store.get().readAt).toBe(100);
});
test("disconnect revokes actions and drops old replies; changes refresh without polling", async () => {
  const f = fixture();
  f.store.start();
  f.status("disconnected");
  f.requests[0]!.resolve({ ...EMPTY_BIN, epoch: "old", revision: 10 });
  await Promise.resolve();
  expect(f.store.get().verified).toBe(false);
  f.status("connected");
  f.requests[f.requests.length - 1]!.resolve({
    ...EMPTY_BIN,
    epoch: "new",
    revision: 0,
  });
  await Promise.resolve();
  expect(f.store.get().verified).toBe(true);
  f.control({ type: "world_bin_changed", revision: 1 });
  expect(f.requests).toHaveLength(3);
  f.store.stop();
});
