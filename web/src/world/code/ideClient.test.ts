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
    // Webviews in World are opt-in per provider: unknown means blank panels.
    expect(status.providers[0]!.webviewsInWorld).toBe(false);
    expect(
      parseIdeStatus({
        providers: [{ id: "code-server", webviewsInWorld: true }],
      }).providers[0]!.webviewsInWorld,
    ).toBe(true);
    expect(status.providers[0]!.needsSecurePage).toBe(false);
    expect(
      parseIdeStatus({ providers: [{ id: "vscode", needsSecurePage: true }] })
        .providers[0]!.needsSecurePage,
    ).toBe(true);
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
  test("a refusal keeps only known codes and drops anything else", () => {
    const result = parseIdeOpenResult({
      ok: false,
      refusal: {
        code: "missing",
        message: "Visual Studio Code isn't installed on devbox.",
        handoff: { command: "code /srv", url: "vscode://file/srv" },
      },
    });
    expect(result).toEqual({
      ok: false,
      refusal: {
        code: "missing",
        message: "Visual Studio Code isn't installed on devbox.",
      },
    });
    const unknown = parseIdeOpenResult({
      ok: false,
      refusal: { code: "origin", message: "Another origin." },
    });
    expect(!unknown.ok && unknown.refusal.code).toBe("unknown-connection");
  });

  test("an instance keeps its SSH destination", () => {
    const result = parseIdeOpenResult({
      ok: true,
      instance: { ...instance, sshDestination: "dev@devbox.example" },
    });
    expect(result.ok && result.instance.sshDestination).toBe(
      "dev@devbox.example",
    );
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
  test("ssh starts the IDE on the SSH host", async () => {
    const client = fixtureIdeClient("ssh");
    const result = await client.open({
      provider: "vscode",
      connectionId: "c1",
      generation: 1,
      folder: "/srv/example/api",
    });
    expect(result).toMatchObject({
      ok: true,
      instance: {
        provider: "vscode",
        state: "starting",
        sshDestination: "devbox.example",
      },
    });
  });

  test("detected starts disabled; enabling then opening starts a server", async () => {
    const client = fixtureIdeClient("detected");
    let changes = 0;
    client.subscribe(() => changes++);
    const embeddable = (await client.status()).providers.find(
      (entry) => entry.id === "code-server",
    );
    expect(embeddable).toMatchObject({
      webviewsInWorld: true,
      enabled: false,
    });
    await client.enable("code-server");
    const result = await client.open({
      connectionId: "c1",
      generation: 1,
      folder: "/srv/example/api",
    });
    expect(result.ok && result.instance.state).toBe("starting");
    expect(changes).toBe(2);
  });

  test("stock VS Code can be enabled and opened, even when missing here", async () => {
    const client = fixtureIdeClient("missing");
    await client.enable("vscode");
    const result = await client.open({
      provider: "vscode",
      connectionId: "c1",
      generation: 1,
      folder: "/srv/example/api",
    });
    expect(result.ok && result.instance.provider).toBe("vscode");
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
