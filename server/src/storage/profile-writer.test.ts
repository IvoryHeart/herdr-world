import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seededProfiles } from "../agent/profile-store";
import { openWorldWriter } from "./world-writer";
import type { ProfileOperation } from "./world-profiles";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const fresh = () => {
  const root = mkdtempSync(join(tmpdir(), "profile-writer-"));
  roots.push(root);
  return {
    root,
    database: join(root, "world.sqlite"),
    ledger: join(root, "ledger.json"),
    profiles: join(root, "agent-profiles.json"),
  };
};
const open = (p: ReturnType<typeof fresh>) =>
  openWorldWriter(
    p.database,
    p.ledger,
    1000,
    "synthetic-incarnation",
    undefined,
    p.profiles,
  );
function orders<T>(values: readonly T[]): T[][] {
  return values.length
    ? values.flatMap((value, index) =>
        orders(values.filter((_, other) => other !== index)).map((rest) => [
          value,
          ...rest,
        ]),
      )
    : [[]];
}

test("all 24 profile/chime/failure orderings read fresh transaction-local state and roll back only the refused edit", () => {
  for (const order of orders([
    "builder",
    "reviewer",
    "chimes",
    "refused",
  ] as const)) {
    const p = fresh(),
      writer = open(p),
      before = writer.read().profiles!;
    const operations: Record<(typeof order)[number], ProfileOperation> = {
      builder: {
        type: "save",
        profile: {
          ...before.profiles.find((profile) => profile.id === "builder")!,
          role: "Synthetic build role",
        },
      },
      reviewer: {
        type: "save",
        profile: {
          ...before.profiles.find((profile) => profile.id === "reviewer")!,
          role: "Synthetic review role",
        },
      },
      chimes: {
        type: "chimes",
        chimes: {
          ...before.chimes,
          motifs: { needs_you: true, for_you: false, finished: true },
        },
      },
      refused: {
        type: "save",
        profile: {
          ...before.profiles.find((profile) => profile.id === "builder")!,
          chime: before.chimes.timbres.town_master,
        },
      },
    };
    let after: typeof before;
    try {
      const result = writer.batch(
        order.map((name, ticket) => ({
          ticket,
          request: { type: "profiles", operation: operations[name] },
        })),
        1000,
      );
      for (const [index, name] of order.entries()) {
        if (name === "refused")
          expect(result[index]!.error).toContain("Town master's chime");
        else expect(result[index]!.error).toBeUndefined();
      }
      after = writer.read().profiles!;
      expect(
        after.profiles.find((profile) => profile.id === "builder")!.role,
      ).toBe("Synthetic build role");
      expect(
        after.profiles.find((profile) => profile.id === "reviewer")!.role,
      ).toBe("Synthetic review role");
      expect(after.chimes.motifs.for_you).toBe(false);
      expect(after.revision).toBe(3);
    } finally {
      writer.close();
    }
    const reopened = open(p);
    try {
      expect(reopened.read().profiles).toEqual(after);
    } finally {
      reopened.close();
    }
  }
});

test("an interrupted profile import commits neither domain rows nor its completion marker", () => {
  const p = fresh(),
    source = JSON.stringify(seededProfiles());
  writeFileSync(p.profiles, source, { mode: 0o600 });
  let interrupted = false;
  try {
    openWorldWriter(
      p.database,
      p.ledger,
      1000,
      "synthetic-incarnation",
      undefined,
      p.profiles,
      () => {
        throw new Error("synthetic interruption");
      },
    );
  } catch {
    interrupted = true;
  }
  expect(interrupted).toBe(true);
  const db = new Database(p.database);
  try {
    for (const table of [
      "agent_profiles",
      "profile_chimes",
      "profile_store_meta",
    ])
      expect(db.query(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({
        count: 0,
      });
    expect(
      db
        .query(
          "SELECT count(*) AS count FROM imports WHERE name='agent-profiles-json'",
        )
        .get(),
    ).toEqual({ count: 0 });
  } finally {
    db.close();
  }
  const recovered = open(p);
  try {
    expect(recovered.read().profiles!.profiles).toHaveLength(4);
  } finally {
    recovered.close();
  }
});

test("a completed import ignores changed source bytes and cannot reseed a deleted starter", () => {
  const p = fresh(),
    source = JSON.stringify(seededProfiles());
  writeFileSync(p.profiles, source, { mode: 0o600 });
  const writer = open(p);
  let saved: ReturnType<typeof seededProfiles>;
  try {
    expect(
      writer.batch(
        [
          {
            ticket: 1,
            request: {
              type: "profiles",
              operation: { type: "delete", id: "designer" },
            },
          },
        ],
        1000,
      )[0]!.error,
    ).toBeUndefined();
    saved = writer.read().profiles!;
    expect(saved.profiles.some((profile) => profile.id === "designer")).toBe(
      false,
    );
  } finally {
    writer.close();
  }
  writeFileSync(
    p.profiles,
    JSON.stringify({ ...seededProfiles(), revision: 99 }),
  );
  let reopened: ReturnType<typeof open> | undefined;
  expect(() => {
    reopened = open(p);
  }).not.toThrow();
  try {
    expect(reopened!.read().profiles).toEqual(saved);
  } finally {
    reopened?.close();
  }
});

test("a conflicting private backup refuses import before any profile row is written", () => {
  const p = fresh(),
    source = JSON.stringify(seededProfiles());
  const backup = `${p.profiles}.${createHash("sha256").update(source).digest("hex")}.sqlite-import.bak`;
  writeFileSync(p.profiles, source, { mode: 0o600 });
  writeFileSync(backup, "A different preserved backup", { mode: 0o600 });
  let writer: ReturnType<typeof open> | undefined;
  try {
    expect(() => {
      writer = open(p);
    }).toThrow(/backup differs/);
  } finally {
    writer?.close();
  }
  expect(readFileSync(backup, "utf8")).toBe("A different preserved backup");
  const db = new Database(p.database);
  try {
    expect(
      db.query("SELECT count(*) AS count FROM agent_profiles").get(),
    ).toEqual({ count: 0 });
  } finally {
    db.close();
  }
});

test("invalid UTF-8 source bytes receive an exact private backup before import refuses them", () => {
  const p = fresh(),
    source = Buffer.from([0x7b, 0xff, 0x7d]);
  writeFileSync(p.profiles, source, { mode: 0o600 });
  const backup = `${p.profiles}.${createHash("sha256").update(source).digest("hex")}.sqlite-import.bak`;
  let writer: ReturnType<typeof open> | undefined;
  try {
    expect(() => {
      writer = open(p);
    }).toThrow();
  } finally {
    writer?.close();
  }
  expect(existsSync(backup)).toBe(true);
  expect(readFileSync(backup)).toEqual(source);
  expect(readFileSync(p.profiles)).toEqual(source);
});
