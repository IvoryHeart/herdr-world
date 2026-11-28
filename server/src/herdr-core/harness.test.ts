import { expect, test } from "bun:test";
import { harnessName } from "./harness";
test("muse-code alias", () => expect(harnessName("muse-code")).toBe("muse"));
