import { describe, expect, test } from "bun:test";
import type { Pane, Tab, Workspace } from "../types";
import {
  OFFICE_PRESENTATION_BOUNDS,
  projectWorldOffice,
  prepareWorldOffice,
  createOfficeProjector,
} from "./herdrOfficeProjection";
import type { WorldRuntimeConnection } from "./runtimeStore";
import { buildWorldObject } from "./worldObject";
import { officePresentationKey } from "./officeSelection";

describe("Pixel Office projection", () => {
  test("prepared presentation lookup matches complete roster resolution and canonical-key priority", async () => {
    const world = buildWorldObject([
      connection(
        "alpha",
        [tab("shared", 1)],
        [
          pane("shared", "working", "Builder", 0),
          pane("shared", "idle", undefined, 1),
        ],
      ),
    ]);
    const reference = projectWorldOffice(world, 1);
    const keys = [
      ...world.nodes.map(({ id }) => id),
      ...reference.paneRoster.map(({ device }) => device.key),
      ...reference.deskRoster.map(({ desk }) => desk.key),
      "unknown",
      null,
    ];
    const expected = keys.map((key) => officePresentationKey(reference, key));
    await prepareWorldOffice(world);
    const prepared = projectWorldOffice(world, 1);
    expect(keys.map((key) => officePresentationKey(prepared, key))).toEqual(
      expected,
    );
    // Prove the hot path cannot regress to scanning the complete pane roster.
    prepared.paneRoster = new Proxy(prepared.paneRoster, {
      get() {
        throw Error("unexpected roster scan");
      },
    });
    expect(keys.map((key) => officePresentationKey(prepared, key))).toEqual(
      expected,
    );
  });
  test("selection overlays reuse topology without changing admission or roster order", async () => {
    const tabs = Array.from({ length: 3 }, (_, index) =>
      tab(`tab-${index}`, index + 1),
    );
    const world = buildWorldObject([
      connection(
        "alpha",
        tabs,
        tabs.flatMap((entry) =>
          Array.from({ length: 6 }, (_, index) =>
            pane(
              entry.tab_id,
              index < 4 ? "working" : index === 4 ? "blocked" : "idle",
              `Synthetic ${index}`,
              index,
            ),
          ),
        ),
      ),
    ]);
    await prepareWorldOffice(world);
    const project = createOfficeProjector();
    const initial = project(world, 1, null);
    const admitted = initial.rooms[0]!.roomAgents[0]!.key;
    const selected = project(world, 2, admitted);
    expect(selected.rooms).toBe(initial.rooms);
    expect(selected).toEqual(projectWorldOffice(world, 2, admitted));
    for (const node of world.nodes) {
      expect(project(world, 3, node.id)).toEqual(
        projectWorldOffice(world, 3, node.id),
      );
      expect(project(world, 4, null)).toEqual(
        projectWorldOffice(world, 4, null),
      );
    }
  });
  test("selection reuse restores bounded desks and promotes admitted agents' omitted desks", async () => {
    const tabs = Array.from(
      { length: OFFICE_PRESENTATION_BOUNDS.desksPerRoom + 2 },
      (_, index) => tab(`tab-${index}`, index + 1),
    );
    const world = buildWorldObject([
      connection(
        "alpha",
        tabs,
        tabs.map((entry, index) =>
          pane(entry.tab_id, "working", `Synthetic ${index}`, index),
        ),
      ),
    ]);
    await prepareWorldOffice(world);
    const project = createOfficeProjector();
    project(world, 1, null);
    for (const node of world.nodes) {
      expect(project(world, 2, node.id)).toEqual(
        projectWorldOffice(world, 2, node.id),
      );
      expect(project(world, 3, null)).toEqual(
        projectWorldOffice(world, 3, null),
      );
    }
  });
  test("selecting an admitted terminal preserves desk, device and standing-agent positions", () => {
    const tabs = Array.from({ length: 3 }, (_, index) =>
      tab(`tab-${index}`, index + 1),
    );
    const world = buildWorldObject([
      connection(
        "alpha",
        tabs,
        tabs.flatMap((entry) =>
          Array.from({ length: 3 }, (_, index) =>
            pane(entry.tab_id, "working", `Synthetic ${index}`, index),
          ),
        ),
      ),
    ]);
    const positions = (selectedId: string | null) => {
      const room = projectWorldOffice(world, 1, selectedId).rooms[0]!;
      return {
        desks: room.desks.map(({ key, paneDevices }) => ({
          key,
          devices: paneDevices.map(({ key }) => key),
        })),
        agents: room.roomAgents.map(({ key }) => key),
      };
    };
    const before = positions(null);
    for (const leaf of world.leaves) expect(positions(leaf.id)).toEqual(before);
  });

  test("revealing an omitted pane preserves bounded device order", () => {
    const world = buildWorldObject([
      connection(
        "alpha",
        [tab("shared", 1)],
        Array.from({ length: 6 }, (_, index) =>
          pane("shared", "working", `Synthetic ${index}`, index),
        ),
      ),
    ]);
    const before = projectWorldOffice(world, 1);
    const beforeKeys = new Set(
      before.rooms[0]!.desks[0]!.paneDevices.map(({ nodeId }) => nodeId),
    );
    const selected = world.leaves.find(({ id }) => !beforeKeys.has(id))!;
    const office = projectWorldOffice(world, 1, selected.id);
    const devices = office.rooms[0]!.desks[0]!.paneDevices;
    expect(devices.some(({ nodeId }) => nodeId === selected.id)).toBe(true);
    const admitted = new Set(devices.map(({ key }) => key));
    expect(devices.map(({ key }) => key)).toEqual(
      before.paneRoster
        .filter(({ device }) => admitted.has(device.key))
        .map(({ device }) => device.key),
    );
    expect(devices).toHaveLength(OFFICE_PRESENTATION_BOUNDS.paneDevicesPerDesk);
  });

  test("terminal and room selections preserve the positions of admitted workspaces", () => {
    const world = buildWorldObject(
      ["alpha", "beta", "gamma"].map((id) =>
        connection(id, [tab("shared", 1)], [pane("shared", "working", id)]),
      ),
    );
    const expected = projectWorldOffice(world, 1).rooms.map(({ key }) => key);
    for (const selected of [...world.spaces, ...world.leaves]) {
      expect(
        projectWorldOffice(world, 1, selected.id).rooms.map(({ key }) => key),
      ).toEqual(expected);
    }
  });

  test("revealing an omitted room retains the stable order of admitted rooms", () => {
    const world = buildWorldObject(
      Array.from({ length: 9 }, (_, index) => boundedConnection(index)),
    );
    const selected = world.spaces[world.spaces.length - 1]!;
    const office = projectWorldOffice(world, 1, selected.id);
    expect(office.rooms.some(({ key }) => key === selected.id)).toBe(true);
    const admitted = new Set(office.rooms.map(({ key }) => key));
    expect(office.rooms.map(({ key }) => key)).toEqual(
      world.spaces.filter(({ id }) => admitted.has(id)).map(({ id }) => id),
    );
    expect(office.rooms).toHaveLength(OFFICE_PRESENTATION_BOUNDS.rooms);
  });

  test("prepared scenes reuse qualified pane devices from the complete roster", async () => {
    const world = buildWorldObject([
      connection(
        "reuse",
        [tab("tab", 1)],
        [pane("tab", "working", "Synthetic")],
      ),
    ]);
    await prepareWorldOffice(world);
    const office = projectWorldOffice(world, 1);
    const device = office.rooms[0]!.desks[0]!.paneDevices[0]!;
    expect(
      device ===
        office.paneRoster.find((entry) => entry.device.key === device.key)!
          .device,
    ).toBe(true);
    const selected = projectWorldOffice(world, 2, device.nodeId);
    expect(selected.rooms[0]!.desks[0]!.paneDevices[0] === device).toBe(true);
    expect(office.paneRoster[0]!.device.order).toBe(0);
  });
  test("cooperative roster preparation preserves selected-room ordering and every qualified flag", async () => {
    const world = buildWorldObject(
      Array.from({ length: 9 }, (_, index) => boundedConnection(index)),
    );
    const selected = world.spaces[world.spaces.length - 1]!.id;
    const before = projectWorldOffice(world, 1, selected);
    await prepareWorldOffice(world);
    expect(projectWorldOffice(world, 1, selected)).toEqual(before);
  });
  test("a large idle roster keeps deterministic bounded bar admission and reserves an omitted selection", async () => {
    const tabs = Array.from({ length: 100 }, (_, index) =>
      tab("tab-" + index, index + 1),
    );
    const panes = tabs.map((entry) =>
      pane(entry.tab_id, "idle", "Synthetic agent"),
    );
    const world = buildWorldObject([connection("beta", tabs, panes)]);
    await prepareWorldOffice(world);
    const ordinary = projectWorldOffice(world, 1);
    const reordered = projectWorldOffice(
      buildWorldObject([connection("beta", tabs, [...panes].reverse())]),
      1,
    );
    expect(ordinary.barAgents.map((agent) => agent.key)).toEqual(
      reordered.barAgents.map((agent) => agent.key),
    );
    expect(ordinary.barAgents).toHaveLength(
      OFFICE_PRESENTATION_BOUNDS.barAgents,
    );
    expect(ordinary.roster).toHaveLength(100);
    const omitted = world.leaves.find(
      (leaf) => !ordinary.barAgents.some((agent) => agent.key === leaf.id),
    )!;
    const selected = projectWorldOffice(world, 1, omitted.id);
    expect(selected.barAgents[0]?.key).toBe(omitted.id);
    expect(selected.barAgents).toHaveLength(
      OFFICE_PRESENTATION_BOUNDS.barAgents,
    );
    expect(selected.coverage.omittedBarAgents).toBe(84);
    expect(
      ordinary.roster.find((entry) => entry.agent.key === omitted.id)
        ?.destinationPresented,
    ).toBe(false);
    expect(
      selected.roster.find((entry) => entry.agent.key === omitted.id)
        ?.destinationPresented,
    ).toBe(true);
  });
  test("an observed search selection reserves its omitted desk, pane and agent without expanding Office bounds", async () => {
    const tabs = Array.from({ length: 20 }, (_, index) =>
      tab(`tab-${index}`, index + 1),
    );
    const panes = tabs.map((entry, index) =>
      pane(entry.tab_id, "working", `Synthetic ${index}`),
    );
    const world = buildWorldObject([connection("beta", tabs, panes)], null);
    await prepareWorldOffice(world);
    const selected = world.leaves[19]!;
    const before = projectWorldOffice(world, 1);
    expect(
      before.paneRoster.find(({ device }) => device.nodeId === selected.id)
        ?.presented,
    ).toBe(false);
    const revealed = projectWorldOffice(world, 1, selected.id);
    expect(
      revealed.paneRoster.find(({ device }) => device.nodeId === selected.id)
        ?.presented,
    ).toBe(true);
    expect(
      revealed.roster.find(({ agent }) => agent.key === selected.id)
        ?.destinationPresented,
    ).toBe(true);
    expect(revealed.rooms[0]!.desks).toHaveLength(
      OFFICE_PRESENTATION_BOUNDS.desksPerRoom,
    );
    expect(revealed.rooms[0]!.omittedDeskCount).toBe(12);
    expect(
      before.paneRoster.find((entry) => entry.device.nodeId === selected.id)
        ?.presented,
    ).toBe(false);
  });
  test("aggregate Office exposes qualified resources on both compatible ready hosts", () => {
    const office = projectWorldOffice(
      buildWorldObject(
        ["alpha", "beta"].map((id) =>
          connection(id, [tab("shared", 1)], [pane("shared", "working", id)]),
        ),
        null,
      ),
      1,
    );
    expect(office.hosts).toHaveLength(2);
    expect(office.rooms.map(({ canOpenInSpaces }) => canOpenInSpaces)).toEqual([
      true,
      true,
    ]);
    expect(
      office.paneRoster.map(({ device }) => device.canOpenInSpaces),
    ).toEqual([true, true]);
    expect(new Set(office.rooms.map(({ key }) => key)).size).toBe(2);
    expect(office.coverage.observedAgents).toBe(2);
  });
  test("places agents by structured status and keeps every admitted tab as a desk", () => {
    const tabs = [
      tab("work", 1),
      tab("unknown", 2),
      tab("blocked", 3),
      tab("idle", 4),
      tab("done", 5),
      tab("shell", 6),
    ];
    const panes = [
      pane("work", "working", "Codex"),
      pane("unknown", "unknown", "Pi"),
      pane("blocked", "blocked", "Claude"),
      pane("idle", "idle", "Gemini"),
      pane("done", "done", "Grok"),
      { ...pane("shell", "unknown"), agent: undefined },
    ];
    const world = buildWorldObject([connection("local", tabs, panes)], "local");

    const office = projectWorldOffice(world, 42);

    expect(office.generatedAt).toBe(42);
    expect(office.coverage).toMatchObject({
      observedAgents: 5,
      observedDesks: 6,
      status: { working: 1, unknown: 1, blocked: 1, idle: 1, done: 1 },
    });
    expect(office.rooms[0].desks).toHaveLength(6);
    expect(
      office.rooms[0].roomAgents.map(({ semanticStatus }) => semanticStatus),
    ).toEqual(["working", "unknown"]);
    expect(
      office.receptions[0].waitingAgents.map(
        ({ semanticStatus }) => semanticStatus,
      ),
    ).toEqual(["blocked", "done"]);
    expect(
      office.barAgents.map(({ semanticStatus }) => semanticStatus),
    ).toEqual(["idle"]);
  });

  test("keeps exact pane devices stable when agents leave desks and exposes omitted panes", () => {
    const panes = Array.from({ length: 5 }, (_, index) =>
      pane("shared", "working", `agent-${index}`, index),
    );
    const source = connection(
      "local",
      [{ ...tab("shared", 1), pane_count: 5 }],
      panes,
    );
    const before = projectWorldOffice(buildWorldObject([source], "local"), 1);
    const desk = before.rooms[0].desks[0];
    expect(desk.paneDevices).toHaveLength(4);
    expect(desk.omittedPaneCount).toBe(1);
    expect(before.paneRoster).toHaveLength(5);
    expect(before.paneRoster.filter(({ presented }) => presented)).toHaveLength(
      4,
    );
    expect(
      new Set(before.paneRoster.map(({ device }) => device.paneRef.nativeId))
        .size,
    ).toBe(5);
    const deviceKeys = desk.paneDevices.map(({ key }) => key);
    panes[0].agent_status = "blocked";
    panes[1].agent_status = "done";
    panes[2].agent_status = "idle";
    const after = projectWorldOffice(buildWorldObject([source], "local"), 2);
    expect(after.rooms[0].desks[0].paneDevices.map(({ key }) => key)).toEqual(
      deviceKeys,
    );
    expect(
      after.receptions[0].waitingAgents
        .map(({ semanticStatus }) => semanticStatus)
        .sort(),
    ).toEqual(["blocked", "done"]);
    expect(after.barAgents.map(({ semanticStatus }) => semanticStatus)).toEqual(
      ["idle"],
    );
    expect(after.rooms[0].desks[0].completionAgentKeys).toHaveLength(1);
    source.snapshot!.panes = panes.slice(1);
    source.snapshot!.tabs[0].pane_count = 4;
    const closed = projectWorldOffice(buildWorldObject([source], "local"), 3);
    expect(
      closed.paneRoster.some(({ device }) => device.key === deviceKeys[0]),
    ).toBe(false);
    expect(closed.rooms[0].desks[0].omittedPaneCount).toBe(0);
    const newGeneration = { ...source, generation: 8, snapshotGeneration: 8 };
    const retired = projectWorldOffice(
      buildWorldObject([newGeneration], "local"),
      4,
    );
    expect(
      retired.paneRoster.every(({ device }) => device.paneRef.generation === 8),
    ).toBe(true);
    expect(
      retired.paneRoster.some(({ device }) => device.key === deviceKeys[1]),
    ).toBe(false);
  });

  test("pane targets distinguish hosts even with colliding native IDs", () => {
    const office = projectWorldOffice(
      buildWorldObject(
        ["local", "other"].map((id) =>
          connection(
            id,
            [tab("shared", 1)],
            [pane("shared", "working", "Agent")],
          ),
        ),
        "local",
      ),
      1,
    );
    expect(
      new Set(office.paneRoster.map(({ device }) => device.key)).size,
    ).toBe(2);
    expect(
      office.paneRoster.map(({ device }) => device.paneRef.connectionId),
    ).toEqual(["local", "other"]);
    expect(
      office.paneRoster.map(({ device }) => device.canOpenInSpaces),
    ).toEqual([true, true]);
  });

  test("qualifies colliding native identifiers and admits both ready host operations", () => {
    const sources = ["host-a", "host-b"].map((id) =>
      connection(id, [tab("shared", 1)], [pane("shared", "working", id)]),
    );
    const office = projectWorldOffice(buildWorldObject(sources, "host-a"), 1);

    expect(new Set(office.hosts.map(({ key }) => key)).size).toBe(2);
    expect(new Set(office.rooms.map(({ key }) => key)).size).toBe(2);
    expect(new Set(office.deskRoster.map(({ desk }) => desk.key)).size).toBe(2);
    expect(new Set(office.roster.map(({ agent }) => agent.key)).size).toBe(2);
    expect(office.hosts.map(({ connectionState }) => connectionState)).toEqual([
      "active",
      "ready-inactive",
    ]);
    expect(office.rooms.map(({ canOpenInSpaces }) => canOpenInSpaces)).toEqual([
      true,
      true,
    ]);
  });

  test("seats only one bounded room agent per desk and reports exact omissions", () => {
    const tabs = Array.from({ length: 9 }, (_, index) =>
      tab(`tab-${index}`, index + 1),
    );
    const panes = Array.from({ length: 18 }, (_, index) =>
      pane(
        index === 17 ? "tab-8" : `tab-${index % 8}`,
        index % 2 ? "unknown" : "working",
        `agent-${index}`,
        index,
      ),
    );
    const office = projectWorldOffice(
      buildWorldObject([connection("local", tabs, panes)], "local"),
      1,
    );
    const room = office.rooms[0];

    expect(room.desks).toHaveLength(OFFICE_PRESENTATION_BOUNDS.desksPerRoom);
    expect(room.roomAgents).toHaveLength(
      OFFICE_PRESENTATION_BOUNDS.roomAgentsPerRoom,
    );
    expect(
      room.roomAgents.filter(({ placement }) => placement === "seated"),
    ).toHaveLength(8);
    expect(room.omittedDeskCount).toBe(1);
    expect(room.omittedAgentCount).toBe(2);
    expect(office.coverage).toMatchObject({
      omittedDesks: 1,
      omittedRoomAgents: 2,
    });
    expect(office.roster).toHaveLength(18);
  });

  test("reports exact Office omissions when aggregate records are bounded", () => {
    const source = connection(
      "local",
      Array.from({ length: 8 }, (_, index) => tab(`tab-${index}`, index + 1)),
      Array.from({ length: 16 }, (_, index) =>
        pane(`tab-${index % 8}`, "working", `agent-${index}`, index),
      ),
    );
    if (!source.snapshot) throw new Error("fixture snapshot missing");
    source.snapshot.coverage = {
      workspaces: 513,
      tabs: 2_049,
      panes: 4_097,
      agentPanes: 4_097,
      status: {
        working: 4_097,
        idle: 0,
        blocked: 0,
        done: 0,
        unknown: 0,
      },
      byWorkspace: [
        {
          workspaceId: "workspace",
          tabs: 9,
          panes: 18,
          agentPanes: 18,
          status: {
            working: 18,
            idle: 0,
            blocked: 0,
            done: 0,
            unknown: 0,
          },
        },
      ],
    };

    const office = projectWorldOffice(buildWorldObject([source], "local"), 1);

    expect(office.rooms[0]).toMatchObject({
      observedDeskCount: 9,
      omittedDeskCount: 1,
      observedAgentCount: 18,
      omittedAgentCount: 2,
    });
    expect(office.coverage).toMatchObject({
      observedWorkspaces: 513,
      observedDesks: 2_049,
      observedAgents: 4_097,
      omittedRooms: 512,
      omittedDesks: 2_041,
      omittedRoomAgents: 4_081,
    });
    expect(office.presentationBounds).toMatchObject({
      totalRooms: 513,
      totalDesks: 2_049,
      totalRoomAgents: 4_097,
    });
  });

  test("keeps mixed-status shared tabs truthful beyond the eight-desk scene bound", () => {
    const tabs = Array.from({ length: 9 }, (_, index) =>
      tab(`tab-${index}`, index + 1),
    );
    const working = pane("tab-0", "working", "working", 1);
    const unknown = {
      ...pane("tab-0", "unknown", "unknown", 2),
      focused: true,
    };
    const outside = pane("tab-8", "working", "outside", 3);
    const office = projectWorldOffice(
      buildWorldObject(
        [connection("local", tabs, [unknown, working, outside])],
        "local",
      ),
      1,
    );
    const room = office.rooms[0];
    const workingAgent = room.roomAgents.find(
      ({ displayLabel }) => displayLabel === "working",
    );
    const unknownAgent = room.roomAgents.find(
      ({ displayLabel }) => displayLabel === "unknown",
    );
    const outsideAgent = room.roomAgents.find(
      ({ displayLabel }) => displayLabel === "outside",
    );

    expect(room.desks[0].occupantAgentKey).toBe(workingAgent?.key);
    expect(workingAgent?.placement).toBe("seated");
    expect(unknownAgent?.placement).toBe("standing");
    expect(outsideAgent).toMatchObject({
      placement: "standing",
      destination: "room",
    });
    expect(
      office.roster.find(({ agent }) => agent.key === outsideAgent?.key),
    ).toMatchObject({
      roomPresented: true,
      deskPresented: false,
    });
  });

  test("retains stale topology without admitting Office operations", () => {
    const source = connection(
      "remote",
      [tab("tab", 1)],
      [pane("tab", "working", "Codex")],
    );
    source.state = "reconnecting";
    source.stale = true;
    source.actionable = false;
    const office = projectWorldOffice(buildWorldObject([source], "remote"), 1);

    expect(office.hosts[0]).toMatchObject({
      connectionState: "reconnecting",
      stale: true,
    });
    expect(office.rooms[0]).toMatchObject({
      stale: true,
      canOpenInSpaces: false,
    });
    expect(office.roster[0].agent).toMatchObject({
      stale: true,
      canOpenInSpaces: false,
      destination: "room",
    });
  });

  test("keeps agent and character identity stable when the owning pane moves", () => {
    const project = (paneId: string) => {
      const source = connection(
        "local",
        [tab("tab", 1)],
        [
          {
            ...pane("tab", "working", "Codex"),
            pane_id: paneId,
            terminal_id: "stable-terminal",
          },
        ],
      );
      return projectWorldOffice(buildWorldObject([source], "local"), 1)
        .roster[0].agent;
    };
    const first = project("old-pane");
    const moved = project("new-pane");

    expect(moved.key).toBe(first.key);
    expect(moved.nodeId).toBe(first.nodeId);
    expect(moved.characterIndex).toBe(first.characterIndex);
    expect(moved.currentPaneRef.nativeId).toBe("new-pane");
    expect(moved.currentPaneRef.nativeId).not.toBe(
      first.currentPaneRef.nativeId,
    );
  });

  test("enforces every scene bound while retaining complete semantic rosters", () => {
    const office = projectWorldOffice(
      buildWorldObject(
        Array.from({ length: 7 }, (_, hostIndex) =>
          boundedConnection(hostIndex),
        ),
        "host-0",
      ),
      1,
    );

    expect(office.presentationBounds).toMatchObject({
      renderedRooms: OFFICE_PRESENTATION_BOUNDS.rooms,
      totalRooms: 129,
      renderedReceptionDesks: OFFICE_PRESENTATION_BOUNDS.receptionDesks,
      totalReceptionDesks: 7,
      renderedRoomAgents: OFFICE_PRESENTATION_BOUNDS.roomAgentsPerRoom,
      totalRoomAgents: 18,
      renderedWaitingAgents:
        OFFICE_PRESENTATION_BOUNDS.waitingAgentsPerReception,
      totalWaitingAgents: 16,
      renderedBarAgents: 10,
      totalBarAgents: 10,
    });
    expect(office.rooms).toHaveLength(128);
    expect(office.roomRoster).toHaveLength(129);
    expect(office.rooms[0].desks).toHaveLength(8);
    expect(office.rooms[0].roomAgents).toHaveLength(16);
    expect(office.receptions[0].waitingAgents).toHaveLength(8);
    expect(office.barAgents).toHaveLength(10);
    expect(office.roster).toHaveLength(44);
    expect(office.coverage).toMatchObject({
      omittedRooms: 1,
      omittedDesks: 4,
      omittedRoomAgents: 2,
      omittedReceptionDesks: 1,
      omittedWaitingAgents: 8,
      omittedBarAgents: 0,
    });
  });

  test("reserves bounded room and reception capacity for the selected host", () => {
    const office = projectWorldOffice(
      buildWorldObject(
        Array.from({ length: 7 }, (_, hostIndex) =>
          boundedConnection(hostIndex),
        ),
        "host-6",
      ),
      1,
    );
    const selectedHost = office.hosts.find(({ selected }) => selected);

    expect(selectedHost).toBeDefined();
    expect(
      office.rooms.some(({ hostKey }) => hostKey === selectedHost?.key),
    ).toBe(true);
    expect(
      office.receptions.some(({ hostKey }) => hostKey === selectedHost?.key),
    ).toBe(true);
    expect(office.coverage).toMatchObject({
      omittedRooms: 1,
      omittedReceptionDesks: 1,
    });
  });

  test("counts every host before applying the reception presentation bound", () => {
    const office = projectWorldOffice(
      buildWorldObject(
        Array.from({ length: 129 }, (_, hostIndex) =>
          connection(`host-${hostIndex}`, [], []),
        ),
        "host-128",
      ),
      1,
    );

    expect(office.coverage).toMatchObject({
      configuredHosts: 129,
      omittedReceptionDesks: 123,
    });
    expect(office.presentationBounds).toMatchObject({
      totalReceptionDesks: 129,
      renderedReceptionDesks: 6,
    });
    expect(
      office.receptions.some(({ hostKey }) => hostKey.includes("host-128")),
    ).toBe(true);
  });

  test("publishes only the admitted bounded tab label to Office desks", () => {
    const source = connection(
      "local",
      [{ ...tab("work", 1), label: `  Work\u0000${" item".repeat(100)}  ` }],
      [pane("work", "working", "Codex")],
    );
    const world = buildWorldObject([source], "local");
    const office = projectWorldOffice(world, 1);

    expect(office.rooms[0].desks[0].displayLabel.length).toBeLessThanOrEqual(
      100,
    );
    expect(office.rooms[0].desks[0].displayLabel).not.toMatch(
      /[\u0000-\u001f]/u,
    );
  });
});

function boundedConnection(hostIndex: number): WorldRuntimeConnection {
  const workspaces = Array.from(
    { length: hostIndex === 0 ? 123 : 1 },
    (_, workspaceIndex): Workspace => ({
      workspace_id: `workspace-${hostIndex}-${workspaceIndex}`,
      number: workspaceIndex + 1,
      label: `Workspace ${hostIndex}-${workspaceIndex}`,
      focused: workspaceIndex === 0,
      pane_count: 0,
      tab_count: 1,
      active_tab_id: `tab-${hostIndex}-${workspaceIndex}`,
      agent_status: "unknown",
    }),
  );
  const tabs = workspaces.map(
    (workspace, index): Tab => ({
      tab_id: `tab-${hostIndex}-${index}`,
      workspace_id: workspace.workspace_id,
      number: 1,
      label: "Tab",
      focused: true,
      pane_count: 0,
      agent_status: "unknown",
    }),
  );
  const panes: Pane[] = [];
  if (hostIndex === 0) {
    for (let index = 0; index < 10; index += 1) {
      tabs.push({
        tab_id: `extra-tab-${index}`,
        workspace_id: workspaces[0].workspace_id,
        number: index + 2,
        label: `Extra ${index}`,
        focused: false,
        pane_count: 0,
        agent_status: "unknown",
      });
    }
    for (let index = 0; index < 18; index += 1) {
      panes.push({
        ...pane(
          index < 9 ? `extra-tab-${index}` : "tab-0-0",
          index % 3 === 0 ? "unknown" : "working",
          `room-${index}`,
          index,
        ),
        workspace_id: workspaces[0].workspace_id,
      });
    }
    for (let index = 0; index < 6; index += 1) {
      panes.push({
        ...pane("tab-0-0", "blocked", `blocked-${index}`, index + 20),
        workspace_id: workspaces[0].workspace_id,
      });
    }
    for (let index = 0; index < 20; index += 1) {
      panes.push({
        ...pane(
          "tab-0-0",
          index % 2 === 0 ? "idle" : "done",
          `bar-${index}`,
          index + 30,
        ),
        workspace_id: workspaces[0].workspace_id,
      });
    }
  }
  return {
    connectionId: `host-${hostIndex}`,
    label: `Host ${hostIndex}`,
    source: "saved-profile",
    isDefault: hostIndex === 0,
    state: "ready",
    generation: 7,
    snapshotGeneration: 7,
    stale: false,
    actionable: true,
    snapshot: { workspaces, tabs, panes, agents: [] },
  };
}

function connection(
  id: string,
  tabs: Tab[],
  panes: Pane[],
): WorldRuntimeConnection {
  const workspace: Workspace = {
    workspace_id: "workspace",
    number: 1,
    label: "Alpha",
    focused: true,
    pane_count: panes.length,
    tab_count: tabs.length,
    active_tab_id: tabs[0]?.tab_id,
    agent_status: "working",
  };
  return {
    connectionId: id,
    label: id,
    source: "saved-profile",
    isDefault: id === "local",
    state: "ready",
    generation: 7,
    snapshotGeneration: 7,
    stale: false,
    actionable: true,
    snapshot: { workspaces: [workspace], tabs, panes, agents: [] },
  };
}

function tab(id: string, number: number): Tab {
  return {
    tab_id: id,
    workspace_id: "workspace",
    number,
    label: `Tab ${number}`,
    focused: number === 1,
    pane_count: 1,
    agent_status: "working",
  };
}

function pane(tabId: string, status: string, agent?: string, index = 0): Pane {
  return {
    pane_id: `pane-${tabId}-${index}`,
    terminal_id: `terminal-${tabId}-${index}`,
    workspace_id: "workspace",
    tab_id: tabId,
    focused: index === 0,
    agent,
    agent_status: status,
    revision: 1,
  };
}
