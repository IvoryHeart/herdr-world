import { describe, expect, it } from "vitest";
import { suggestedConnectionName } from "./BackendSettingsDialog";

describe("connection name suggestions", () => {
  it("uses the hostname or IP without copying protocol and port", () => {
    expect(suggestedConnectionName("http://192.0.2.145:8787")).toBe("192.0.2.145");
    expect(suggestedConnectionName("herdr.example:8791")).toBe("herdr.example");
    expect(suggestedConnectionName("http://[2001:db8::20]:8787")).toBe("2001:db8::20");
    expect(suggestedConnectionName("not a valid address")).toBe("");
  });
});
