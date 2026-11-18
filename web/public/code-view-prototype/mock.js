/* Synthetic interaction study only. No IDE, process, token, storage or network. */
((document) => {
  const $ = (selector) => document.querySelector(selector);
  const rooms = {
    orchard: {
      name: "Orchard",
      host: "Demo workstation",
      runtime: "herdr-core",
      builder: "Scout",
      agents: ["Scout", "Wren"],
      branch: "scout/welcome",
      connection: "demo-local",
      ssh: false,
    },
    notes: {
      name: "Field notes",
      host: "Demo SSH node",
      runtime: "Herdr TUI",
      builder: "Finch",
      agents: ["Finch"],
      branch: "finch/notes",
      connection: "demo-ssh",
      ssh: true,
    },
  };
  const providers = {
    microsoft: {
      name: "VS Code web · Microsoft CLI",
      detail:
        "code serve-web · Microsoft Marketplace · licence + compatibility gates",
      web: true,
    },
    openvscode: {
      name: "OpenVSCode Server",
      detail: "MIT distribution · Open VSX · separate settings/extensions",
      web: true,
    },
    coder: {
      name: "code-server",
      detail: "MIT distribution · Open VSX · self-contained webviews",
      web: true,
    },
    "VS Code": {
      name: "VS Code desktop",
      detail: "Project handoff · browsing-device installation unknown",
      web: false,
    },
    Cursor: {
      name: "Cursor",
      detail: "Desktop handoff · provider-specific remote connection",
      web: false,
    },
    "JetBrains Gateway": {
      name: "JetBrains Gateway",
      detail: "Desktop handoff · remote IDE backend via SSH",
      web: false,
    },
    Zed: {
      name: "Zed",
      detail: "Desktop handoff · native local/SSH project",
      web: false,
    },
  };
  function initialHost(remote) {
    return {
      selected: "microsoft",
      offline: false,
      blocked: false,
      integrations: Object.fromEntries(
        Object.entries(providers).map(([id, p]) => [
          id,
          {
            installed: !p.web || (remote ? id === "coder" : id !== "coder"),
            enabled: !p.web || (!remote && id === "microsoft"),
          },
        ]),
      ),
    };
  }
  let hosts = { orchard: initialHost(false), notes: initialHost(true) };
  let view = "Town",
    roomId = "orchard",
    checkout = "room",
    file = "source";
  let terminal = "Scout",
    attached = false,
    warned = false,
    panel = "changes",
    mobile = "agents";
  let changed = false,
    picker = false,
    handoff = false,
    desktopTarget = "VS Code";
  let message = "All controls use synthetic data. No IDE is running.";
  let returnFocus;
  const room = () => rooms[roomId];
  const host = () => hosts[roomId];
  const unavailable = () =>
    host().offline
      ? "offline"
      : host().blocked
        ? "blocked"
        : !host().integrations[host().selected].installed
          ? "missing"
          : !host().integrations[host().selected].enabled
            ? "disabled"
            : "";
  function text(tag, content, className = "") {
    const node = document.createElement(tag);
    node.textContent = content;
    node.className = className;
    return node;
  }
  function button(label, action, value) {
    const node = text("button", label);
    node.dataset.action = action;
    if (value !== undefined) node.dataset.value = value;
    return node;
  }
  function selectRoom(id) {
    roomId = id;
    terminal = room().builder;
    checkout = "room";
    attached = false;
    warned = false;
    file = "source";
    changed = false;
    message = `${room().name} keeps its exact ${room().connection} connection. No other host is used.`;
  }
  function renderPicker() {
    $("#picker").hidden = !picker;
    $("#picker-host").textContent =
      `${room().host} · ${room().connection}${room().ssh ? " · SSH" : " · local"}`;
    const list = $("#provider-list");
    list.replaceChildren();
    for (const [id, provider] of Object.entries(providers)) {
      const status = host().integrations[id];
      const row = text("div", "", "provider");
      const info = text("div", "");
      info.append(
        text("h3", provider.name),
        text("p", provider.detail, "muted"),
        text(
          "p",
          `${status.installed ? (provider.web ? "Detected (fixture)" : "Handoff configured; client unknown") : "Not installed · owner setup needed"} · ${status.enabled ? "Enabled on this host" : "Disabled on this host"}`,
        ),
      );
      const actions = text("div", "", "provider-actions");
      if (provider.web && !status.installed)
        actions.append(button("Mark installed (mock)", "installed", id));
      else {
        actions.append(
          button(
            status.enabled ? "Disable (mock)" : "Enable (mock)",
            "enable",
            id,
          ),
        );
        const open = button(
          provider.web ? "Use web IDE (mock)" : "Preview handoff",
          provider.web ? "provider" : "desktop-target",
          id,
        );
        open.disabled = !status.enabled || host().offline;
        actions.append(open);
      }
      row.append(info, actions);
      list.append(row);
    }
  }
  function renderHandoff() {
    $("#handoff").hidden = !handoff;
    $("#handoff-project").textContent =
      `${room().name} · ${room().host} · ${checkout === "agent" ? room().branch : "main"}`;
    $("#handoff-detail").textContent = host().offline
      ? "Host disconnected. Handoff is unavailable until this exact host is revalidated."
      : !host().integrations[desktopTarget].enabled
        ? `${desktopTarget} is disabled on this host. Enable it in IDE integrations before handing off.`
        : `${desktopTarget} · ${room().ssh ? "SSH project on Demo SSH node" : "Project on Demo workstation"} · ${checkout === "agent" ? room().builder + "’s linked checkout" : "Room checkout"}. ${room().ssh ? "Use this IDE’s supported SSH/Gateway connection; never a local file URL." : "Open directly only if this browser device owns these local files; otherwise use a remote connection."} Client availability unknown. No app launched; no credentials included.`;
    document
      .querySelectorAll('[data-action="desktop-target"]')
      .forEach((node) => {
        node.disabled =
          host().offline || !host().integrations[node.dataset.value].enabled;
        node.setAttribute(
          "aria-pressed",
          String(node.dataset.value === desktopTarget),
        );
      });
  }
  function render() {
    const r = room(),
      h = host(),
      reason = unavailable();
    $("#overview").hidden = view === "Code";
    $("#ide").hidden = view !== "Code";
    $("#projection-label").textContent = `${view.toUpperCase()} / ROOM DETAIL`;
    $("#location").textContent = `${r.host} / ${r.runtime} / ${r.connection}`;
    $("#project-title").textContent = r.name;
    $("#project-select").value = roomId;
    $("#agent-checkout").textContent = `${r.builder}’s checkout`;
    $("#checkout-label").textContent =
      checkout === "agent"
        ? `${r.builder} / ${r.branch}`
        : "Room checkout / main";
    $("#provider-label").textContent = providers[h.selected].name;
    $("#vscode-title").textContent =
      `${r.name} — ${h.selected === "microsoft" ? "Visual Studio Code" : providers[h.selected].name}`;
    $("#folder-label").textContent = `⌄ ${r.name.toUpperCase()}`;
    $("#file-label").textContent =
      `${checkout === "agent" ? r.branch : "main"} / ${file === "source" ? "src / greeting.ts" : "README.md"}`;
    $("#code-content").textContent =
      file === "source"
        ? `1  // ${r.name} · synthetic example
2  export function greeting(name: string) {
3    return \`${changed ? "Hello" : "Welcome"}, \${name}!\`;
4  }

${changed ? "// Agent update shown in native Source Control" : "// Files and edits belong to real VS Code"}`
        : `# ${r.name}

A project shared with ${r.agents.join(" and ")}.

This is a labelled VS Code stand-in, not a World editor.`;
    $("#workbench").hidden = Boolean(reason);
    $("#embed-unavailable").hidden = !reason;
    const reasons = {
      offline: [
        "Host disconnected",
        "This project's last context is stale. No IDE requests, handoffs or terminal input are sent. Reconnect this exact host; nothing is replayed.",
      ],
      blocked: [
        "Embedding blocked · webview origin",
        "Fixture: the installed VS Code needs a Microsoft CDN webview origin that today's World policy does not permit. Do not loosen CSP silently. Choose an explicit desktop handoff; no IDE is running here.",
      ],
      missing: [
        "VS Code web is not installed on this host",
        "Discovery does not install or start software. Open IDE integrations to inspect this host's providers. Mark installed is a testing-only fixture action.",
      ],
      disabled: [
        "IDE integration is disabled on this host",
        "Enable the installed provider explicitly after reviewing full shell/write trust and its licence. This preview changes memory only.",
      ],
    };
    if (reason) {
      $("#unavailable-title").textContent = reasons[reason][0];
      $("#unavailable-detail").textContent = reasons[reason][1];
    }
    const tabs = $("#terminal-tabs");
    tabs.replaceChildren();
    const agents = $("#agent-context");
    agents.replaceChildren();
    for (const name of r.agents) {
      const tab = button(`World: ${name}`, "terminal", name);
      tab.setAttribute("aria-pressed", String(name === terminal));
      tabs.append(tab);
      const agent = button(
        `${name} · ${name === r.builder ? "Working" : "Reviewing"}`,
        "terminal",
        name,
      );
      agent.setAttribute("aria-pressed", String(name === terminal));
      agents.append(agent);
    }
    agents.append(
      text(
        "p",
        `${terminal} · ${r.runtime} · ${h.offline ? "Stale" : "Existing terminal"}`,
        "muted",
      ),
      text(
        "pre",
        `${terminal} / ${r.connection}
${h.offline ? "Disconnected. Native World input unavailable." : "Native World terminal preview (synthetic).\nReading the welcome change…"}`,
      ),
    );
    $("#terminal-title").textContent =
      `${terminal} · ${r.runtime} · ${attached ? "Attached (mock)" : "Profile available"}`;
    $("#attach").disabled = Boolean(reason);
    $("#attach").textContent = attached
      ? "Detach profile (mock)"
      : warned
        ? "Confirm shared resize (mock)"
        : "Attach profile (mock)";
    $("#resize-warning").hidden = !r.ssh;
    $("#terminal-output").textContent = attached
      ? `${terminal} / ${r.connection}
› ${terminal === r.builder ? "Update the welcome message" : "Review the change"}
${r.runtime === "herdr-core" ? "Core screen-watch / typing adapter (mock)." : "Herdr pane stream (mock) · dimensions shared by every viewer."}
Existing agent attached. No replacement process.`
      : "Terminal profile supplied by the proposed World extension.\nAttach an existing agent; no new shell or agent starts.";
    const activity = $("#change-content");
    activity.replaceChildren();
    if (panel === "pr") {
      activity.append(
        text("p", "PULL REQUEST / SYNTHETIC", "eyebrow"),
        text("h3", "PR #42 · Welcome people by name"),
        text("p", `${r.builder} · ${r.branch} → main`),
        text(
          "p",
          h.offline
            ? "Stale · not actionable"
            : "Checks passed (fixture) · Review requested",
        ),
      );
      const review = button("Review in VS Code (mock)", "review");
      review.disabled = Boolean(reason);
      activity.append(review);
    } else {
      activity.append(
        text("p", "WORKING TREE / NATIVE SOURCE CONTROL", "eyebrow"),
        text(
          "h3",
          changed ? "Agent update · 1 file changed" : "Project activity",
        ),
        text(
          "p",
          `${r.builder} is working in ${r.branch}. A terminal name does not prove line authorship.`,
        ),
      );
      if (changed)
        activity.append(
          text(
            "pre",
            "- return `Welcome, ${name}!`;\n+ return `Hello, ${name}!`;",
          ),
        );
      activity.append(
        text(
          "p",
          "Real diffs, conflicts and saves stay in the IDE. World keeps the linked project and PR evidence.",
        ),
      );
    }
    $("#native-content").hidden = mobile !== "files";
    $("#ide").dataset.mobile = mobile;
    $("#branch-label").textContent =
      `⑂ ${checkout === "agent" ? r.branch : "main"}`;
    $("#connection-state").textContent =
      `${h.offline ? "○ Disconnected · stale" : "● Connected (fixture)"} / ${r.host}`;
    $("#offline").textContent = h.offline
      ? "Reconnect host (mock)"
      : "Disconnect host (mock)";
    $("#blocked").textContent = h.blocked
      ? "Clear embed block (mock)"
      : "Block embedding (mock)";
    $("#notice").textContent = message;
    $("#notice").hidden = picker || handoff;
    document.querySelectorAll("button[data-value]").forEach((node) => {
      const selection = {
        view,
        checkout,
        file,
        panel,
        mobile,
        provider: h.selected,
      }[node.dataset.action];
      if (selection !== undefined)
        node.setAttribute(
          "aria-pressed",
          String(node.dataset.value === selection),
        );
    });
    renderPicker();
    renderHandoff();
    for (const child of [$(".study"), $(".shell"), $("#overview"), $("#ide")])
      child.inert = picker || handoff;
  }
  function closeDialog() {
    picker = false;
    handoff = false;
    render();
    returnFocus?.focus();
  }
  document.addEventListener("keydown", (event) => {
    if (!picker && !handoff) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key === "Tab") {
      const dialog = $(picker ? "#picker" : "#handoff");
      const nodes = [...dialog.querySelectorAll("button:not(:disabled)")];
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  document.addEventListener("click", (event) => {
    const node = event.target.closest("button[data-action]");
    if (!node || node.disabled) return;
    const action = node.dataset.action,
      value = node.dataset.value;
    if (action === "view") {
      view = value;
      attached = false;
      warned = false;
    }
    if (action === "open") {
      selectRoom(value);
      view = "Code";
    }
    if (action === "checkout") {
      checkout = value;
      attached = false;
      warned = false;
    }
    if (action === "file") file = value;
    if (action === "terminal") {
      terminal = value;
      attached = false;
      warned = false;
      message = `${terminal}'s existing ${room().runtime} terminal selected. Checkout is unchanged.`;
    }
    if (action === "panel") {
      panel = value;
      mobile = "changes";
    }
    if (action === "mobile") mobile = value;
    if (action === "attach" && !unavailable()) {
      if (room().ssh && !attached && !warned) {
        warned = true;
        message =
          "Confirm shared resize: attaching this Herdr pane changes dimensions for every viewer, including observers.";
      } else {
        attached = !attached;
        warned = false;
        message = attached
          ? "Existing terminal attached (mock). No new process; focus and input remain the IDE terminal's responsibility."
          : "Profile detached. Existing agent keeps running.";
      }
    }
    if (action === "integrations") {
      returnFocus = node;
      picker = true;
      handoff = false;
    }
    if (action === "close-picker" || action === "close-handoff") {
      closeDialog();
      return;
    }
    if (action === "installed") {
      host().integrations[value].installed = true;
      message =
        "Testing-only installed-state switch. No software downloaded, terms accepted or process started.";
    }
    if (action === "enable") {
      host().integrations[value].enabled = !host().integrations[value].enabled;
      attached = false;
      warned = false;
      message =
        "Host-specific enablement changed in memory only. Real shell/write trust and licence acceptance remain future gates.";
    }
    if (action === "provider") {
      host().selected = value;
      attached = false;
      warned = false;
      message = `Explicit provider choice: ${providers[value].name}. No silent marketplace substitution.`;
      closeDialog();
      return;
    }
    if (action === "desktop" || action === "desktop-target") {
      if (!picker && !handoff) returnFocus = node;
      picker = false;
      handoff = true;
      if (action === "desktop-target") desktopTarget = value;
    }
    if (action === "agent-change") {
      changed = true;
      panel = "changes";
      message =
        "Synthetic agent update is shown in the IDE's file and Source Control context. No World save API.";
    }
    if (action === "review") {
      checkout = "agent";
      file = "source";
      changed = true;
      mobile = "ide";
      message = `Native VS Code comparison requested for ${room().builder}'s exact checkout (mock). PR #42 is synthetic.`;
    }
    if (action === "offline") {
      host().offline = !host().offline;
      attached = false;
      warned = false;
      message = host().offline
        ? "Exact host disconnected. Attached profile revoked; no keys or writes queued."
        : "Exact host revalidated (mock). Terminal remains detached; no input replay.";
    }
    if (action === "blocked") {
      host().blocked = !host().blocked;
      attached = false;
      warned = false;
      message =
        "Embedding compatibility changed (mock). No CSP or origin policy was changed.";
    }
    if (action === "extensions")
      message =
        "Real VS Code owns extensions, Settings Sync and profiles. Desktop, browser and remote extensions are not automatically identical; see the research matrix.";
    if (action === "reset") {
      hosts = { orchard: initialHost(false), notes: initialHost(true) };
      selectRoom("orchard");
      view = "Town";
      mobile = "agents";
      panel = "changes";
      picker = false;
      handoff = false;
    }
    render();
    if (picker || handoff)
      $(picker ? "#picker .close" : "#handoff .close").focus();
  });
  document.addEventListener("change", (event) => {
    if (event.target.id === "project-select") {
      selectRoom(event.target.value);
      render();
    }
  });
  render();
})(globalThis.document);
