// Standalone design fixture. No API, runtime, credentials, or persistent storage.
((document, location) => {
  const $ = (selector) => document.querySelector(selector);
  const rooms = {
    orchard: {
      name: "Orchard",
      host: "Demo workstation",
      runtime: "herdr-core",
      builder: "Scout",
      reviewer: "Wren",
      branch: "welcome-copy",
    },
    notes: {
      name: "Field notes",
      host: "Demo SSH node",
      runtime: "Herdr TUI",
      builder: "Finch",
      branch: "field-guide",
    },
  };
  const original =
    "export function greeting(name: string) {\n  return `Hello, ${name}`;\n}\n\n// A small welcome, made together.\n";
  const updated =
    "export function greeting(name: string) {\n  return `Welcome, ${name}!`;\n}\n\n// A small welcome, made together.\n";
  const buffers = new Map();
  const disconnected = new Set();
  let roomId = "orchard",
    opened = false,
    view = "Town",
    checkout = "room";
  let file = "source",
    terminal = "builder",
    control = false,
    panel = "changes";
  let message =
    "Open a file or select an agent. All controls use example data.";
  let output = "",
    mobile = "code";
  const key = () => `${roomId}/${checkout}/${file}`;
  function buffer() {
    if (!buffers.has(key())) {
      const text =
        file === "source"
          ? original
          : `# ${rooms[roomId].name}\n\nA synthetic project for the World Code view study.\n`;
      buffers.set(key(), {
        text,
        saved: text,
        remote: text,
        changed: false,
        conflict: false,
      });
    }
    return buffers.get(key());
  }
  function render() {
    const room = rooms[roomId],
      current = buffer(),
      offline = disconnected.has(roomId);
    $("#overview").hidden = view === "Code" && opened;
    $("#ide").hidden = !$("#overview").hidden;
    $("#projection-label").textContent = `${view.toUpperCase()} / ROOM DETAIL`;
    $("#location").textContent = `${room.host} / ${room.runtime} / Room`;
    $("#project-title").textContent = room.name;
    $("#agent-checkout").textContent = `${room.builder}’s checkout`;
    $("#checkout-label").textContent =
      checkout === "agent" ? `${room.builder} / ${room.branch}` : "Room / main";
    $("#file-label").textContent =
      file === "source" ? "src / greeting.ts" : "README.md";
    $("#buffer").value = current.text;
    $("#buffer").readOnly = offline;
    $("#line-numbers").textContent = current.text
      .split("\n")
      .map((_, i) => i + 1)
      .join("\n");
    $("#buffer-state").textContent = current.conflict
      ? "Conflict · your draft is kept"
      : current.text !== current.saved
        ? "Unsaved example · memory only"
        : "Example buffer · memory only";
    $("#save").disabled = offline;
    const names = [
      ["builder", room.builder],
      ...(room.reviewer ? [["reviewer", room.reviewer]] : []),
    ];
    $("#terminal-tabs").innerHTML = names
      .map(
        ([id, name]) =>
          `<button data-action="terminal" data-value="${id}" aria-pressed="${id === terminal}"><span class="dot"></span>${name}</button>`,
      )
      .join("");
    const name = terminal === "reviewer" ? room.reviewer : room.builder;
    $("#terminal-title").textContent =
      `${name} · ${room.runtime} · ${offline ? "Disconnected" : control ? "Control (mock)" : "Observing"}`;
    $("#terminal-output").textContent =
      output ||
      `${name} / ${room.branch}\n\n› ${terminal === "reviewer" ? "Review the welcome change" : "Update the welcome message"}\n\n${terminal === "reviewer" ? "Checking the diff and the example tests.\nPR #42 is ready for your review." : "Reading src/greeting.ts…\nPreparing a small, reviewable change.\nThe agent keeps its existing terminal."}\n`;
    $("#control").disabled = offline;
    $("#control").textContent = control
      ? "Release control (mock)"
      : "Take control (mock)";
    $("#terminal-input").disabled = !control || offline;
    $("#send").disabled = !control || offline;
    $("#connection-state").textContent =
      `${offline ? "○ Disconnected · stale" : "● Connected (example)"} / ${room.host}`;
    $("#branch-label").textContent =
      `⑂ ${checkout === "agent" ? room.branch : "main"}`;
    $("#offline").textContent = offline
      ? "Reconnect host (mock)"
      : "Disconnect host (mock)";
    $("#ide").dataset.mobile = mobile;
    $("#notice").textContent = message;
    renderChanges(current, room);
    document.querySelectorAll("button[data-value]").forEach((button) => {
      const selection = { view, checkout, file, panel, mobile, open: roomId }[
        button.dataset.action
      ];
      if (selection !== undefined)
        button.setAttribute(
          "aria-pressed",
          String(selection === button.dataset.value),
        );
    });
  }
  function renderChanges(current, room) {
    const target = $("#change-content");
    target.replaceChildren();
    const add = (tag, text, className = "") => {
      const element = document.createElement(tag);
      element.textContent = text;
      element.className = className;
      target.append(element);
    };
    if (panel === "pr") {
      add("p", "PULL REQUEST / EXAMPLE", "eyebrow");
      add("h2", `PR #42 · ${room.name}`);
      add("p", "Welcome people by name");
      add("p", `${room.builder} · ${room.branch} → main`);
      add("p", "Checks passed (fixture) · Review requested", "positive");
      add(
        "p",
        "Associated by the reported branch and repository. This is not proof of which agent wrote each line.",
      );
      const button = document.createElement("button");
      button.textContent = "Review changed file";
      button.dataset.action = "review";
      target.append(button);
      add(
        "p",
        "In the proposed view, Open on GitHub opens the validated PR URL. No external PR exists for this example.",
        "subtle",
      );
    } else {
      add(
        "p",
        current.conflict ? "COMPARE BEFORE SAVING" : "WORKING TREE / EXAMPLE",
        "eyebrow",
      );
      add(
        "h2",
        current.conflict
          ? "An agent changed this file"
          : "A small change, in context",
      );
      add(
        "p",
        checkout === "agent"
          ? `${room.builder}’s checkout · ${room.branch}`
          : "Room checkout · main",
      );
      add(
        "p",
        current.changed
          ? "Agent update received · 1 file changed"
          : "Preview of the agent’s proposed change",
      );
      add(
        "pre",
        "- return `Hello, ${name}`;\n+ return `Welcome, ${name}!`;",
        "diff",
      );
      if (current.conflict) {
        add("h3", "Your unsaved draft");
        add("pre", current.text, "diff");
        add("h3", "Agent version");
        add("pre", current.remote, "diff");
        const button = document.createElement("button");
        button.textContent = "Use agent version (discard example draft)";
        button.dataset.action = "reload";
        target.append(button);
      }
      add(
        "p",
        "Files and PRs belong to a checkout. Agent activity is context; Git records file changes.",
        "subtle",
      );
    }
  }
  $("#buffer").addEventListener("input", (event) => {
    buffer().text = event.target.value;
    $("#buffer-state").textContent = buffer().conflict
      ? "Conflict · your draft is kept"
      : "Unsaved example · memory only";
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || button.disabled) return;
    const { action, value } = button.dataset;
    const current = buffer();
    if (action === "open") {
      if (roomId !== value) {
        checkout = "room";
        terminal = "builder";
        control = false;
        output = "";
        $("#terminal-input").value = "";
      }
      roomId = value;
      opened = true;
      view = "Code";
      mobile = "code";
      message =
        "Project opened on its original connection. Choose a file, checkout or agent.";
    } else if (action === "view") {
      view = value;
      control = false;
    } else if (action === "file") {
      file = value;
      mobile = "code";
    } else if (action === "checkout") {
      checkout = value;
      message =
        "Checkout switched explicitly. Each example buffer is kept separately.";
    } else if (action === "terminal") {
      terminal = value;
      control = false;
      output = "";
      $("#terminal-input").value = "";
    } else if (action === "control") control = !control;
    else if (action === "mobile") mobile = value;
    else if (action === "panel") {
      panel = value;
      mobile = "changes";
    } else if (action === "review") {
      checkout = "agent";
      file = "source";
      panel = "changes";
      mobile = "changes";
      message =
        "Reviewing PR #42 in the agent’s checkout. Other checkout drafts are kept.";
    } else if (action === "save") {
      if (current.conflict)
        message =
          "Compare your draft with the agent version before saving. Nothing was overwritten.";
      else {
        current.saved = current.text;
        current.remote = current.text;
        message = "Example saved in memory. No real file was written.";
      }
    } else if (action === "agent-change") {
      if (disconnected.has(roomId)) {
        message = "Disconnected: no fresh agent update is available.";
      } else {
        file = "source";
        const source = buffer();
        source.changed = true;
        source.remote = updated;
        source.conflict = source.text !== source.saved;
        if (!source.conflict) source.text = source.saved = updated;
        panel = "changes";
        mobile = "changes";
        message = source.conflict
          ? "Compare before saving: the agent version changed. Your draft is kept."
          : "Agent update received. The clean example buffer refreshed; review Changes or PR #42.";
      }
    } else if (action === "reload") {
      current.text = current.saved = current.remote;
      current.conflict = false;
      message =
        "Using the agent version. The example draft was explicitly discarded.";
    } else if (action === "offline") {
      if (disconnected.has(roomId)) disconnected.delete(roomId);
      else disconnected.add(roomId);
      control = false;
      $("#terminal-input").value = "";
      message = disconnected.has(roomId)
        ? "Host disconnected. Cached files are stale; input and saving are disabled. Your draft is kept."
        : "Same host revalidated (mock). Your draft is kept; take control again to send input. No input was replayed.";
    } else if (action === "send") {
      output = `${$("#terminal-output").textContent}\n[Mock input; never executed] ${$("#terminal-input").value}\n`;
      $("#terminal-input").value = "";
    } else if (action === "reset") {
      location.reload();
      return;
    }
    render();
    const replacement = document.querySelector(
      `button[data-action="${action}"]${value ? `[data-value="${value}"]` : ""}`,
    );
    if (replacement && !replacement.closest("[hidden]")) replacement.focus();
  });
  $("#terminal-input").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("#send").click();
  });
  render();
})(globalThis.document, globalThis.location);
