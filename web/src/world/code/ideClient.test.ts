import { describe, expect, test } from "bun:test";
import {
  fixtureIdeClient,
  parseIdeInstance,
  parseIdeOpenResult,
  parseIdeStatus,
} from "./ideClient";

const instance = {
  id: "abcdefABCDEF0123",
  provider: "vscode",
  connectionId: "local",
  folder: "/srv/example/api",
  state: "ready",
  url: "/ide/abcdefABCDEF0123/",
  startedAt: "2026-01-01T00:00:00.000Z",
};

describe("parseIdeInstance", () => {
  test("accepts World's own /ide/<id>/ address only", () => {
    expect(parseIdeInstance(instance)?.url).toBe("/ide/abcdefABCDEF0123/");
    for (const url of [
      "https://example.com/ide/abcdefABCDEF0123/",
      "//example.com/ide/abcdefABCDEF0123/",
      "/ide/short/",
      "/ide/abcdefABCDEF0123/../../api/",
      "javascript:alert(1)",
    ])
      expect(parseIdeInstance({ ...instance, url })).toBeNull();
  });

  test("refuses unknown providers and states", () => {
    expect(parseIdeInstance({ ...instance, provider: "emacs" })).toBeNull();
    expect(parseIdeInstance({ ...instance, state: "zombie" })).toBeNull();
  });
});

describe("parseIdeStatus", () => {
  test("drops malformed providers and keeps https terms only", () => {
    const status = parseIdeStatus({
      providers: [
        {
          id: "vscode",
          label: "Visual Studio Code",
          marketplace: "Microsoft Marketplace",
          terms: [
            { label: "Terms", url: "https://example.com/terms" },
            { label: "Bad", url: "http://example.com/terms" },
          ],
          setupUrl: "javascript:alert(1)",
          detection: { state: "detected", path: "/opt/example/code" },
          enabled: true,
        },
        { id: "nope" },
        null,
      ],
      instances: [instance, { ...instance, url: "/elsewhere/" }],
      localConnections: ["local", 7],
    });
    expect(status.localConnections).toEqual(["local"]);
    expect(status.providers).toHaveLength(1);
    expect(status.providers[0]!.terms).toEqual([
      { label: "Terms", url: "https://example.com/terms" },
    ]);
    expect(status.providers[0]!.setupUrl).toBe("");
    expect(status.providers[0]!.detection).toMatchObject({
      state: "detected",
      version: null,
    });
    expect(status.instances).toHaveLength(1);
  });

  test("anything else is an empty status", () => {
    expect(parseIdeStatus("nope")).toEqual({
      providers: [],
      instances: [],
      localConnections: [],
    });
  });
});

describe("parseIdeOpenResult", () => {
  test("a handoff keeps only a vscode:// link", () => {
    const refusal = (url: string) =>
      parseIdeOpenResult({
        ok: false,
        refusal: {
          code: "remote",
          message: "Over SSH.",
          handoff: {
            command: "code --remote ssh-remote+devbox.example /srv",
            url,
          },
        },
      });
    const good = refusal(
      "vscode://vscode-remote/ssh-remote+devbox.example/srv",
    );
    expect(good.ok).toBe(false);
    if (!good.ok) expect(good.refusal.handoff?.url).toStartWith("vscode://");
    const bad = refusal("https://example.com/");
    if (!bad.ok) expect(bad.refusal.handoff).toBeUndefined();
  });

  test("an ok result with a bad instance is a refusal, never a frame", () => {
    const result = parseIdeOpenResult({
      ok: true,
      instance: { ...instance, url: "https://example.com/" },
    });
    expect(result.ok).toBe(false);
  });
});

describe("fixtureIdeClient", () => {
  test("ssh refuses with a Remote-SSH handoff for the folder", async () => {
    const client = fixtureIdeClient("ssh");
    const result = await client.open({
      connectionId: "c1",
      generation: 1,
      folder: "/srv/example/api",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusal.code).toBe("remote");
      expect(result.refusal.handoff?.command).toContain("/srv/example/api");
    }
  });

  test("detected starts disabled; enabling then opening starts a server", async () => {
    const client = fixtureIdeClient("detected");
    let changes = 0;
    client.subscribe(() => changes++);
    expect((await client.status()).providers[0]!.enabled).toBe(false);
    await client.enable("vscode");
    const result = await client.open({
      connectionId: "c1",
      generation: 1,
      folder: "/srv/example/api",
    });
    expect(result.ok && result.instance.state).toBe("starting");
    expect(changes).toBe(2);
  });

  test("failed shows its reason", async () => {
    const result = await fixtureIdeClient("failed").open({
      connectionId: "c1",
      generation: 1,
      folder: "/srv/example/api",
    });
    expect(result.ok && result.instance.reason).toContain("could not bind");
  });
});
