module herdr_core_runtime {
  import runtime_leases.capturedLeaseCurrent from "./runtime-leases"
  import effect_recovery.opaqueReplayBlocked from "./effect-recovery"
  // TLC omits replay-only labels/receipts, never guard or invariant inputs.
  pure val CHECKING = false
  pure val BROKEN = false
  pure val FAULT = "none"
  // Simulation samples the observe family on its own (the runner sets this),
  // so the ordering and authority families keep their sampling unchanged.
  // The checker always explores every family, each with its own actions.
  pure val OBSERVE = false
  pure def fault(name) = FAULT == name or (BROKEN and name == "lost-delta")
  pure val EVENT_BOUND = 2
  type Terminal = { alive: bool, born: bool, x: int, y: int, occupant: int }
  type Event = { epoch: int, gen: int, seq: int, target: int, kind: str }
  // Observe family: a core-to-World frame on World's watch stream. Grids are
  // ids: 0/1 the desktop pane's sizes, 2 core's headless grid, 3 a size no
  // pane set (an unviewed terminal's creation size, or World's own).
  type Frame = { kind: str, grid: int, stream: int }
  type State = { source: List[Terminal], mirror: List[Terminal], history: List[List[Terminal]],
    queue: List[Event], seq: int, cursor: int, epoch: int, generation: int, owner: int,
    connected: bool, ready: bool, running: bool, changes: int, replaced: bool,
    captured: bool, leaseGen: int, leaseOwner: int, leaseEpoch: int, session: int,
    foreground: bool, pending: bool, queued: bool, uncertain: bool, attempts: int, delivered: int,
    admitted: bool, dispatched: bool, published: bool, safe: bool,
    child: bool, planned: bool, confirmedChild: bool, confirmedOccupant: int, killed: bool,
    planGen: int, planOwner: int, planEpoch: int, tornDown: bool, removed: bool,
    lead: int, grid: int, watching: bool, confirmed: bool, frames: List[Frame],
    credit: bool, pendingGrid: int, backlog: bool, stream: int, shown: int,
    misdrawn: bool, typed: bool, outputs: int }
  var family: str
  var c: State
  var op: str
  var target: int
  pure val terminal = { alive: true, born: true, x: 0, y: 0, occupant: 0 }
  pure val initial = List(terminal, { ...terminal, alive: false, born: false })
  action init = {
    nondet choice = (if (CHECKING) Set(0, 1, 2, 3, 4)
      else if (OBSERVE) Set(4) else Set(0, 1, 2, 3)).oneOf()
    all {
    family' = if (choice == 0) "ordering" else if (choice == 4) "observe" else "authority",
    c' = { source: initial, mirror: initial, history: List(initial), queue: List(),
      seq: 0, cursor: -1, epoch: 0, generation: 0, owner: 0,
      connected: false, ready: false, running: true, changes: 0, replaced: false,
      captured: false, leaseGen: -1, leaseOwner: -1, leaseEpoch: -1, session: -1,
      foreground: true, pending: false, queued: false, uncertain: false, attempts: 0, delivered: 0,
      admitted: false, dispatched: false, published: false, safe: true,
      // Terminal 1, once born, is a child core ends with terminal 0 (M7).
      child: choice == 2 or choice == 3, planned: false, confirmedChild: false,
      confirmedOccupant: -1, killed: false,
      planGen: -1, planOwner: -1, planEpoch: -1, tornDown: false, removed: false,
      lead: -1, grid: 3, watching: false, confirmed: false, frames: List(),
      credit: true, pendingGrid: -1, backlog: false, stream: 0, shown: -1,
      misdrawn: false, typed: false, outputs: 0 },
    op' = "init", target' = 0,
    }
  }
  action change(updated, name, t) = all {
    family' = family,
    c' = if (CHECKING) { ...updated, admitted: false, dispatched: false, published: false } else updated,
    op' = if (CHECKING) "step" else name, target' = if (CHECKING) 0 else t,
  }
  val lease = capturedLeaseCurrent(c.ready and c.connected, c.owner, c.generation, c.leaseOwner, c.leaseGen)
    and c.epoch == c.leaseEpoch
  val occupant = c.source[0].alive and c.source[0].occupant == c.session
  // Checker quotient: the send fence (lease, occupant, queue) and the kill
  // fence (plan, confirmation) read disjoint fields and each is checked
  // against every source, cursor and connection change, so the checker runs
  // sends in the authority family without a child and kills in the one with
  // a child instead of their product. Simulation keeps both in both.
  val sends = not(CHECKING) or not(c.child)
  val kills = not(CHECKING) or c.child
  action connect = all {
    not(c.connected), c.generation < 2,
    // An absent endpoint is a failed direct connection, never a CLI autostart.
    change({ ...c, connected: c.running, ready: false, generation: c.generation + 1,
      cursor: if (fault("keep-cursor")) c.cursor else -1 }, "connect", 0),
  }
  action baseline = all {
    c.connected, not(c.ready),
    val accept = not(fault("keep-cursor")) or c.seq >= c.cursor
    change({ ...c, mirror: if (accept) c.source else c.mirror,
      cursor: if (accept) c.seq else c.cursor, ready: accept,
      safe: c.safe and accept }, "baseline", 0),
  }
  pure def delta(ts, t, kind) = ts.replaceAt(t,
    if (kind == "create") { ...terminal, occupant: ts[t].occupant }
    else if (kind == "remove") { ...ts[t], alive: false }
    else if (kind == "x") { ...ts[t], x: ts[t].x + 1 }
    else { ...ts[t], y: ts[t].y + 1 })
  action emit(t, kind) = all {
    c.running, family != "observe", c.changes < (if (family == "ordering") EVENT_BOUND else 1),
    if (kind == "create") not(c.source[t].born) else c.source[t].alive,
    val updated = delta(c.source, t, kind)
    change({ ...c, source: updated, history: c.history.append(updated), seq: c.seq + 1,
      changes: c.changes + 1,
      queue: if (c.connected) c.queue.append({ epoch: c.epoch, gen: c.generation,
        seq: c.seq + 1, target: t, kind: kind }) else c.queue }, kind, t),
  }
  action receive = all {
    c.connected, c.ready, c.queue.length() > 0,
    val e = c.queue.head()
    val current = e.gen == c.generation and e.epoch == c.epoch
    val stale = e.seq <= c.cursor
    val gap = e.seq > c.cursor + 1
    val apply = current and ((not(stale) and not(gap)) or
      (stale and fault("stale-after-missed")) or (gap and fault("gap-admitted")))
    change({ ...c, queue: c.queue.tail(),
      ready: not(current and gap) or fault("gap-admitted"),
      mirror: if (apply and not(fault("lost-delta") and c.queue.length() > 1))
        delta(c.mirror, e.target, e.kind) else c.mirror,
      cursor: if (apply) e.seq else c.cursor }, "receive", e.target),
  }
  action missed = all {
    c.connected, c.queue.length() > 0,
    // Already queued callbacks survive; all events at/below this cut are discarded.
    change({ ...c, mirror: c.source, cursor: c.seq, ready: true }, "missed", 0),
  }
  action drop = all {
    c.queue.length() > 0,
    change({ ...c, queue: c.queue.tail() }, "drop", 0),
  }
  action heartbeat = all {
    c.connected, c.ready, c.seq > c.cursor,
    change({ ...c, ready: fault("heartbeat-ignored"), safe: c.safe and not(fault("heartbeat-ignored")) }, "heartbeat", 0),
  }
  // A watch ends with its connection: its in-flight frames belong to a stream
  // World no longer has, and the next watch is a new stream with fresh credit.
  pure def endWatch(s: State): State = if (s.watching) { ...s, watching: false,
    stream: s.stream + 1, credit: true, pendingGrid: -1, backlog: false } else s
  action disconnect = all {
    c.connected,
    change(endWatch({ ...c, connected: false, ready: false,
      uncertain: c.uncertain or c.pending }), "disconnect", 0),
  }
  action restart = all {
    c.epoch == 0,
    // Holders preserve terminals/occupants; a core process resets the sequence.
    change(endWatch({ ...c, epoch: 1, seq: 0, history: List(c.source), connected: false,
      ready: false, uncertain: c.uncertain or c.pending }), "restart", 0),
  }
  action absent = all {
    c.generation == 0, c.running,
    change({ ...c, running: false }, "absent", 0),
  }
  action switchProfile = all {
    family == "authority", sends, c.owner == 0,
    // Both profiles point at the SAME durable core; ownership still differs.
    change({ ...c, owner: 1 }, "switchProfile", 0),
  }
  action replace = all {
    family == "authority", c.source[0].alive, not(c.replaced),
    // Kept replacement keeps tN (and may reuse a pid); session evidence changes.
    val updated = c.source.replaceAt(0, { ...c.source[0], occupant: 1 })
    change({ ...c, source: updated, replaced: true,
      history: c.history.replaceAt(c.seq, updated), ready: false }, "replace", 0),
  }
  action capture = all {
    family == "authority", sends, c.ready, not(c.captured), c.source[0].alive,
    change({ ...c, captured: true, leaseGen: c.generation, leaseOwner: c.owner,
      leaseEpoch: c.epoch, session: c.source[0].occupant,
      admitted: true, safe: c.safe and c.connected }, "capture", 0),
  }
  action loseForeground = all {
    family == "authority", c.foreground,
    change({ ...c, foreground: false }, "loseForeground", 0),
  }
  action dispatch = all {
    c.captured, c.attempts == 0,
    val allowed = (lease or (fault("same-core-stale") and c.ready) or
      (fault("profile-fallback") and c.ready and c.generation == c.leaseGen) or
      fault("not-ready")) and (occupant or fault("stale-session")) and (c.foreground or fault("missing-foreground"))
    change({ ...c, attempts: if (allowed) 1 else 0,
      pending: allowed, queued: allowed, dispatched: allowed,
      safe: c.safe and (not(allowed) or (lease and occupant and c.foreground)) }, "dispatch", 0),
  }
  action deliver = all {
    c.queued,
    // Q3 assumption: CORE fences the original recipient at queued execution.
    // World checks before dispatch; current core may lack this later gate.
    val allowed = occupant or fault("ungated-queue")
    change({ ...c, queued: false, delivered: if (allowed) c.delivered + 1 else c.delivered,
      safe: c.safe and (not(allowed) or occupant) }, "deliver", 0),
  }
  action complete = all {
    c.pending,
    // A transcript read also follows capture/dispatch/complete. Its contents
    // publish only while the original foreground still holds; a reading link
    // grants no write authority and changes no modeled source state.
    val allowed = lease and occupant and (c.foreground or fault("publication-foreground"))
    change({ ...c, pending: false, published: allowed,
      safe: c.safe and (not(allowed) or c.foreground),
      uncertain: c.uncertain or not(allowed) }, "complete", 0),
  }
  action recover = all {
    c.uncertain, c.ready,
    val replay = not(opaqueReplayBlocked(c.attempts > 0, "opaque", false)) or fault("replay-write")
    change({ ...c, attempts: if (replay) c.attempts + 1 else c.attempts,
      safe: c.safe and not(replay) }, "recover", 0),
  }
  action queuedReplacement = all { c.queued, replace }
  // Sampling weight only: a child core starts after World planned a kill.
  action childAfterPlan = all { c.planned, not(c.killed), emit(1, "create") }
  // Exercise a dropped nonlast delta followed by its later event explicitly.
  action dropFirst = all { c.queue.length() > 1, drop }
  action receiveGap = all { c.queue.length() > 0, c.queue.head().seq > c.cursor + 1, receive }
  // M7: World names everything a kill ends from its observation; the kill
  // is sent only while that observation still matches what was confirmed:
  // no unconfirmed child would die and the terminal runs the same program.
  // A child core creates after World's last applied event is outside this
  // fence (core has no conditional kill), like the Q3 queued-send window.
  action plan = all {
    family == "authority", kills, c.ready, c.mirror[0].alive, not(c.planned),
    change({ ...c, planned: true, confirmedChild: c.child and c.mirror[1].alive,
      confirmedOccupant: c.mirror[0].occupant, planGen: c.generation, planOwner: c.owner, planEpoch: c.epoch }, "plan", 0),
  }
  action kill = all {
    c.planned, not(c.killed),
    val unconfirmed = c.child and c.mirror[1].alive and not(c.confirmedChild)
    val replaced = c.mirror[0].occupant != c.confirmedOccupant
    val allowed = c.ready and c.mirror[0].alive and
      (not(unconfirmed) or fault("unconfirmed-cascade")) and
      (not(replaced) or fault("stale-confirmation"))
    // Core ends the terminal and the child that dies with it: a silent
    // source change, so World reacquires before showing the result.
    val ended = c.source.replaceAt(0, { ...c.source[0], alive: false })
    val cascaded = if (c.child) ended.replaceAt(1, { ...ended[1], alive: false }) else ended
    change({ ...c, killed: allowed,
      source: if (allowed) cascaded else c.source,
      history: if (allowed) c.history.replaceAt(c.seq, cascaded) else c.history,
      ready: c.ready and not(allowed),
      safe: c.safe and (not(allowed) or not(unconfirmed or replaced)) }, "kill", 0),
  }
  // P4: removing a worktree room whose terminal 0 World confirmed ending.
  // The teardown hook runs only while that confirmation still matches the
  // observation (a stale one runs nothing and ends nothing). The checkout
  // goes only after the teardown and after every confirmed terminal ended,
  // and only under the generation the removal was planned in: a reconnect
  // between steps stops it, so no folder is removed under a live program.
  val planningLease = c.connected and c.generation == c.planGen and
    c.owner == c.planOwner and c.epoch == c.planEpoch
  action teardown = all {
    family == "authority", c.planned, not(c.killed), not(c.tornDown),
    val unconfirmed = c.child and c.mirror[1].alive and not(c.confirmedChild)
    val replaced = c.mirror[0].occupant != c.confirmedOccupant
    val allowed = c.ready and c.mirror[0].alive and
      (planningLease or fault("teardown-unconfirmed")) and
      (not(unconfirmed or replaced) or fault("teardown-unconfirmed"))
    change({ ...c, tornDown: allowed,
      safe: c.safe and (not(allowed) or (planningLease and not(unconfirmed or replaced))) }, "teardown", 0),
  }
  action removeCheckout = all {
    c.tornDown, not(c.removed),
    val current = planningLease
    val allowed = (c.killed or fault("remove-before-kill")) and
      (current or fault("remove-after-retire"))
    change({ ...c, removed: allowed,
      safe: c.safe and (not(allowed) or (c.killed and current)) }, "removeCheckout", 0),
  }

  // ---- Observe family: watching a terminal never sizes it ----------------
  // Core's size rule: the most recently active typing viewer (the desktop
  // pane) sets the grid; with none the terminal is headless. A confirmed
  // observer gets RESIZE before the repaint drawn for it; pending output is
  // superseded, and the pair waits for credit. Unconfirmed observers get no
  // RESIZE at all.
  pure def wire(s: State, g: int): State =
    if (not(s.watching) or not(s.confirmed)) s
    else if (s.credit) { ...s, backlog: false, frames: s.frames
      .append({ kind: "resize", grid: g, stream: s.stream })
      .append({ kind: "data", grid: g, stream: s.stream }) }
    else { ...s, pendingGrid: g, backlog: false }
  // The desktop app's pane opens (g = 0/1), resizes, or closes (g = -1).
  action pane(g) = all {
    family == "observe", c.running, c.changes < 3, g != c.lead,
    val led = if (g >= 0) g else 2
    val moved = { ...c, lead: g, grid: led, changes: c.changes + 1 }
    // target: the pane's size id, 2 for closed.
    change(if (led != c.grid) wire(moved, led) else moved, "pane", if (g < 0) 2 else g),
  }
  // The program prints: bytes for the current grid, held while stalled.
  action output = all {
    family == "observe", c.running, c.outputs < 2, c.frames.length() < 4,
    change({ ...c, outputs: c.outputs + 1,
      frames: if (c.watching and c.credit)
        c.frames.append({ kind: "data", grid: c.grid, stream: c.stream }) else c.frames,
      backlog: c.backlog or (c.watching and not(c.credit) and c.pendingGrid < 0) },
      "output", 0),
  }
  // World attaches. `target` records whether the core path confirmed resize
  // notifications. An observer never leads: alone, it moves an unviewed
  // terminal to headless (core's documented attach exception).
  action watch = {
    nondet path = Set(true, false).oneOf()
    all {
      family == "observe", c.ready, not(c.watching), c.stream < 2,
      val accept = path or fault("unconfirmed-accepted")
      val lead = if (fault("interactive-attach")) 3
        else if (c.lead >= 0) c.lead else 2
      val opened = { ...c, watching: true, confirmed: path, grid: lead, shown: -1,
        credit: true, pendingGrid: -1, backlog: false,
        frames: if (path) c.frames
            .append({ kind: "resize", grid: lead, stream: c.stream })
            .append({ kind: "data", grid: lead, stream: c.stream })
          else c.frames.append({ kind: "data", grid: lead, stream: c.stream }) }
      change(if (accept) opened else { ...c, confirmed: path },
        "watch", if (path) 1 else 0),
    }
  }
  action unwatch = all {
    family == "observe", c.watching,
    change(endWatch(c), "unwatch", 0),
  }
  // The page's socket falls behind: World stops crediting core.
  action stall = all {
    family == "observe", c.watching, c.credit,
    change({ ...c, credit: false }, "stall", 0),
  }
  // It drains: credit flows, and core sends the newest grid and its repaint
  // (never the superseded backlog), or the held output.
  action drain = all {
    family == "observe", c.watching, not(c.credit),
    val flushed = if (c.pendingGrid >= 0) c.frames
        .append({ kind: "resize", grid: c.pendingGrid, stream: c.stream })
        .append({ kind: "data", grid: c.pendingGrid, stream: c.stream })
      else if (c.backlog) c.frames.append({ kind: "data", grid: c.grid, stream: c.stream })
      else c.frames
    change({ ...c, credit: true, frames: flushed, pendingGrid: -1, backlog: false },
      "drain", 0),
  }
  // The page consumes the next frame: a grid resizes its terminal, data is
  // drawn on the grid it currently has. Frames of an ended stream are dropped.
  action frame = all {
    family == "observe", c.frames.length() > 0,
    val f = c.frames.head()
    val current = (c.watching and f.stream == c.stream) or fault("stale-stream")
    val resize = current and f.kind == "resize" and not(fault("paint-before-resize"))
    val drawn = current and f.kind == "data"
    change({ ...c, frames: c.frames.tail(),
      shown: if (resize) f.grid else c.shown,
      misdrawn: c.misdrawn or (drawn and c.shown != f.grid) }, "frame", 0),
  }
  // A phone rotates or opens its keyboard: only the drawing rescales.
  action viewport = all {
    family == "observe", c.watching, not(c.typed),
    change({ ...c, typed: fault("observer-input") }, "viewport", 0),
  }
  action choices = {
    nondet t = Set(0, 1).oneOf()
    nondet kind = Set("create", "remove", "x", "y").oneOf()
    any { connect, baseline, emit(t, kind), receive, missed, drop, heartbeat,
      disconnect, restart, absent, switchProfile, replace, loseForeground, capture, dispatch, deliver, complete, recover,
      plan, kill, teardown, removeCheckout }
  }
  // The observe family's own choices. The simulator's weighting depends on
  // which branches are listed, so they stay out of the other families' set.
  action observeChoices = {
    nondet g = Set(-1, 0, 1).oneOf()
    any { connect, baseline, disconnect, restart,
      pane(g), output, watch, unwatch, stall, drain, frame, viewport }
  }
  // Simulation weights do not multiply the checker's successor computation.
  // The checker gives each family the same actions simulation does: observe
  // actions are family-guarded, so the ordering and authority families lose
  // nothing, and the observe family is not multiplied by connection actions
  // (absent, heartbeat) that its own scenarios never take.
  action step = if (CHECKING) (if (family == "observe") observeChoices else choices)
    else if (family == "observe") any { observeChoices,
      watch, watch, frame, frame, frame, stall, stall, drain, drain, baseline, baseline }
    else any { choices, capture, dispatch,
      dropFirst, dropFirst, receiveGap, receiveGap,
      queuedReplacement, queuedReplacement, queuedReplacement, queuedReplacement,
      plan, plan, kill, kill, childAfterPlan, childAfterPlan, childAfterPlan,
      teardown, teardown, teardown, removeCheckout, removeCheckout, removeCheckout }
  val projection = not(c.ready) or (c.connected and c.cursor >= 0 and
    c.cursor <= c.seq and c.mirror == c.history[c.cursor])
  // Watching never sizes, types or focuses, and every paint lands on its grid.
  val watched = not(c.misdrawn) and not(c.typed) and
    (not(c.watching) or c.grid == (if (c.lead >= 0) c.lead else 2))
  val safety = c.safe and projection and c.attempts <= 1 and
    (c.running or not(c.connected)) and watched
  val orderedDelta = op == "receive" and c.ready and c.cursor > 0
  val missedCut = op == "missed"
  val gapRetired = (op == "heartbeat" or op == "receive") and not(c.ready)
  // Search a gap on a known terminal: an unknown terminal has its own
  // retirement guard, which would mask a missing sequence-gap guard.
  val noReceiveGap = not(op == "receive" and c.connected and not(c.ready) and
    c.mirror[target].born and c.mirror[target].alive)
  // Worktree actions change sampling weights; explicitly find the old-plan
  // replacement refusal for the production pid-only kill control. Use no
  // child so the independent unconfirmed-cascade guard cannot mask it.
  val noStaleKillAttempt = not(op == "kill" and not(c.child) and c.ready and c.planned and
    c.mirror[0].alive and c.mirror[0].occupant != c.confirmedOccupant)
  val reconnected = op == "baseline" and c.generation == 2 and c.ready
  val replacementFenced = op == "dispatch" and c.replaced and c.attempts == 0
  val queueFenced = op == "deliver" and c.replaced and c.delivered == 0
  val existingOnly = op == "connect" and not(c.running) and not(c.connected)
  val cascadeConfirmed = op == "kill" and c.killed and c.child and c.confirmedChild
  val worktreeRemoved = op == "removeCheckout" and c.removed
  val teardownFenced = op == "teardown" and not(c.tornDown) and c.ready
  val unconfirmedCascadeRefused = op == "kill" and not(c.killed) and c.child and
    c.mirror[1].alive and not(c.confirmedChild)
  val watchAdopted = op == "frame" and c.watching and c.shown >= 0 and c.shown == c.grid
  val observerAlone = op == "watch" and c.watching and c.lead < 0
  val headlessFollowed = op == "frame" and c.watching and c.shown == 2 and c.changes > 1
  val stallReleased = op == "drain" and c.frames.length() > 0
  val unconfirmedRefused = op == "watch" and not(c.watching)
}
