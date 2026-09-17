import { expect, test } from "bun:test";
import {
  canonicalPackageIdsFromLock,
  generateDependencyArtifacts,
} from "./dependency-notices";

test("derives a platform-independent package set from the lockfile", () => {
  const lock = `{
    "packages": {
      "portable": ["portable@1.0.0", "", {}],
      "native": ["native@1.0.0", "", { "os": "linux", "cpu": "x64" }],
      "workspace": ["workspace@workspace:web"]
    }
  }`;

  expect(canonicalPackageIdsFromLock(lock)).toEqual(["portable@1.0.0"]);
});

test("includes exact bundled dependency licence and copyright texts", async () => {
  const generated = await generateDependencyArtifacts();

  expect(generated.notices).toContain("| codemirror | 6.0.2 | MIT |");
  expect(generated.notices).toContain("| lucide-react | 1.21.0 | ISC |");
  expect(generated.notices).not.toContain("@biomejs/cli-linux-x64");
  expect(generated.licenses).toContain(
    "Copyright (C) 2018-2021 by Marijn Haverbeke",
  );
  expect(generated.licenses).toContain(
    "Copyright (c) 2026 Lucide Icons and Contributors",
  );
  expect(generated.licenses).toContain("Copyright (c) 2013-present Cole Bemis");
  expect(generated.licenses).toContain(
    "Copyright (c) 2010-2016 Rasmus Andersson",
  );
  expect(generated.licenses).toContain(
    "`lru_map@0.4.1` — `README.md#MIT license`",
  );
});
