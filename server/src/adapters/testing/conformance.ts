import { describe, expect, test } from "bun:test";
import { AdapterSession } from "../session";
import type { AdapterDefinition, AdapterPage, AdapterRow } from "../types";

export type ConformanceFixture = {
  definition: AdapterDefinition<unknown>;
  context: unknown;
  kind: string;
  row(id: string, evidence?: string): AdapterRow;
  set(
    rows: AdapterRow[],
    options?: { complete?: boolean; epoch?: string },
  ): void;
  emit(): void;
  calls(): number;
  watches(): number;
  hold(): () => void;
  corrupt(change: (page: AdapterPage) => AdapterPage): void;
};

/** Same executable admission assertions; fixtures only translate native APIs. */
export function adapterConformance(
  name: string,
  fixture: () => ConformanceFixture,
) {
  describe(name + " adapter conformance", () => {
    function setup(enabled = true, instanceId = "source:a/b") {
      const f = fixture();
      let current = true;
      let invalidations = 0;
      let opened = 0;
      const definition = {
        ...f.definition,
        open(context: unknown) {
          opened++;
          return f.definition.open(context);
        },
      };
      const session = new AdapterSession(
        definition,
        f.context,
        {
          instanceId,
          isCurrent: () => current,
          monotonic: () => 1000,
        },
        enabled,
        () => invalidations++,
      );
      return {
        f,
        session,
        retireOwner: () => {
          current = false;
        },
        invalidations: () => invalidations,
        opened: () => opened,
      };
    }

    test("native IDs are instance qualified, opaque and case sensitive", async () => {
      const a = setup(),
        b = setup(true, "source:a");
      for (const s of [a, b]) s.f.set([s.f.row("A/b:c"), s.f.row("a/b:c")]);
      const ar = await a.session.refresh(),
        br = await b.session.refresh();
      expect(new Set([...ar, ...br].map((row) => row.key)).size).toBe(4);
      a.session.retire();
      b.session.retire();
    });

    test("only a complete listing ends absent rows", async () => {
      const { f, session } = setup();
      f.set([f.row("retained")]);
      const [captured] = await session.refresh();
      f.set([], { complete: false });
      expect(await session.refresh()).toHaveLength(1);
      expect(session.resolve(captured)).toBe("attached");
      f.set([]);
      expect(await session.refresh()).toHaveLength(0);
      expect(session.resolve(captured)).toBe("ended");
      session.retire();
    });

    test("reset and ID reuse end old captures; changed evidence never reattaches", async () => {
      const { f, session } = setup();
      f.set([f.row("same", "before")]);
      const [old] = await session.refresh();
      f.set([f.row("same", "after")], { epoch: "reset" });
      const [replacement] = await session.refresh();
      expect(session.resolve(old)).toBe("ended");
      expect(session.resolve(replacement)).toBe("attached");
      f.set([f.row("same", "again")], { epoch: "reset" });
      await session.refresh();
      expect(session.resolve(replacement)).toBe("ended");
      session.retire();
    });

    test("delete then reuse with identical evidence starts a new lifetime", async () => {
      const { f, session } = setup();
      f.set([f.row("same")]);
      const [old] = await session.refresh();
      f.set([]);
      await session.refresh();
      f.set([f.row("same")]);
      const [next] = await session.refresh();
      expect(session.resolve(old)).toBe("ended");
      expect(session.resolve(next)).toBe("attached");
      session.retire();
    });

    test("events before listing, reordered, duplicated and missing are repaired by reading", async () => {
      const s = setup();
      s.f.set([s.f.row("real")]);
      await s.session.refresh();
      const before = s.f.calls();
      // These carry no payload: never apply an event's claimed create/delete.
      s.f.emit();
      s.f.emit();
      s.f.emit();
      expect(s.invalidations()).toBe(3);
      s.f.set([s.f.row("new")]);
      expect((await s.session.refresh()).map((r) => r.nativeId)).toEqual([
        "new",
      ]);
      expect(s.f.calls()).toBeGreaterThan(before);
      s.f.set([s.f.row("missing-event")]);
      expect((await s.session.refresh()).map((r) => r.nativeId)).toEqual([
        "missing-event",
      ]);
      s.session.retire();
    });

    test("an event before the first listing completes requires a clean reread", async () => {
      const s = setup();
      s.f.set([s.f.row("first")]);
      const release = s.f.hold();
      const work = s.session.refresh();
      s.f.emit();
      release();
      const [row] = await work;
      expect(s.session.resolve(row)).toBe("unconfirmed");
      expect(s.session.claims(row)).toEqual([]);
      await s.session.refresh();
      expect(s.session.resolve(row)).toBe("attached");
      s.session.retire();
    });

    test("unknown kinds and fields are ignored and counted", async () => {
      const { f, session } = setup();
      f.set([
        {
          ...f.row("real"),
          payload: { ...f.row("real").payload, future: "ignored" },
        },
        { kind: "unknown", payload: {} },
      ]);
      const [row] = await session.refresh();
      expect(session.entities()).toHaveLength(1);
      expect(row.payload).not.toHaveProperty("future");
      expect(session.ignored).toEqual({ kinds: 1, fields: 1 });
      session.retire();
    });

    test("unsupported verbs fail before opening or dispatching", async () => {
      const { f, session } = setup();
      for (const verb of ["undeclared", "toString", "__proto__"])
        await expect(session.dispatch(verb, {})).rejects.toThrow("undeclared");
      expect(f.calls()).toBe(0);
      expect(f.watches()).toBe(0);
      session.retire();
    });

    test("coalesces reads and drops a late result after retirement", async () => {
      const s = setup();
      s.f.set([s.f.row("late")]);
      const release = s.f.hold();
      const first = s.session.refresh();
      expect(s.session.refresh()).toBe(first);
      s.retireOwner();
      release();
      expect(await first).toEqual([]);
      expect(s.session.entities()).toEqual([]);
      s.session.retire();
      expect(s.f.watches()).toBe(0);
    });

    test("disabled adapter has no requests, watches, or scheduled work", async () => {
      const { f, session, opened } = setup(false);
      expect(await session.refresh()).toEqual([]);
      await expect(session.dispatch("undeclared", {})).rejects.toThrow();
      expect(f.calls()).toBe(0);
      expect(f.watches()).toBe(0);
      expect(opened()).toBe(0);
      session.retire();
    });

    test("claims retain field provenance and require continuity evidence", async () => {
      const { f, session } = setup();
      f.set([f.row("claims")]);
      const [row] = await session.refresh();
      expect(session.claims(row)).toContainEqual(
        expect.objectContaining({
          field: "label",
          value: "Example",
          instanceId: "source:a/b",
          epoch: row.epoch,
        }),
      );
      f.set([f.row("claims", "")]);
      const [unconfirmed] = await session.refresh();
      expect(session.resolve(unconfirmed)).toBe("unconfirmed");
      expect(session.claims(unconfirmed)).toEqual([]);
      session.retire();
    });

    for (const limit of ["bytes", "entities", "pageSize"] as const) {
      test(
        "rejects a source exceeding " + limit + " without publication",
        async () => {
          const { f, session } = setup();
          f.set([f.row("over")]);
          const limits = f.definition.descriptor.limits;
          f.corrupt((page) =>
            limit === "bytes"
              ? { ...page, padding: "x".repeat(limits.bytes) }
              : {
                  ...page,
                  rows: Array.from({ length: limits[limit] + 1 }, (_, i) =>
                    f.row(String(i)),
                  ),
                },
          );
          await expect(session.refresh()).rejects.toThrow("limit");
          expect(session.entities()).toEqual([]);
          session.retire();
        },
      );
    }
  });
}
