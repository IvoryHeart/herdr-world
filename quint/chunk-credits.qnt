module chunk_credits {
  pure val BROKEN = false
  type Slot = { phase: str, index: int }
  var slots: List[Slot]
  var live: List[bool]
  var op: str
  var socket: int
  var id: int
  var index: int
  var released: bool
  var rejected: bool
  var releasedSocket: int
  var releasedIndex: int
  var releasedId: int
  pure def key(h, i) = if (h == 0) i else 3
  pure def active(xs, h) = xs.indices().filter(k => k.idiv(3) == h and Set("open", "waiting").contains(xs[k].phase)).size()
  pure val EMPTY = { phase: "new", index: -1 }
  action init = all {
    slots' = List(EMPTY, EMPTY, EMPTY, EMPTY), live' = List(true, true),
    op' = "init", socket' = -1, id' = -1, index' = -1,
    released' = false, rejected' = false, releasedSocket' = -1, releasedIndex' = -1, releasedId' = -1,
  }
  action event(name, h, i, n, xs, rejectedNow) = all {
    slots' = xs, live' = live, op' = name, socket' = h, id' = i, index' = n,
    released' = false, rejected' = rejectedNow, releasedSocket' = -1, releasedIndex' = -1, releasedId' = -1,
  }
  action open(h, i) = all {
    live[h], h == 0 or i == 0, slots[key(h, i)].phase != "closed",
    val allowed = slots[key(h, i)].phase == "new" and active(slots, h) < 2
    event("open", h, i, -1, if (allowed) slots.replaceAt(key(h, i), { phase: "open", index: -1 }) else slots, not(allowed)),
  }
  action wait(h, i, n) = all {
    h == 0 or i == 0, slots[key(h, i)].phase != "new",
    val allowed = slots[key(h, i)].phase == "open"
    event("wait", h, i, n, if (allowed) slots.replaceAt(key(h, i), { phase: "waiting", index: n }) else slots, not(allowed)),
  }
  action acknowledge(h, i, n) = {
    val own = key(h, i)
    val peer = key(1 - h, i)
    val matchingOwn = (h == 0 or i == 0) and slots[own].phase == "waiting" and slots[own].index == n
    val matchingPeer = (h == 1 or i == 0) and slots[peer].phase == "waiting" and slots[peer].index == n
    val recipient = if (matchingOwn) own else if (BROKEN and matchingPeer) peer else -1
    all {
      slots' = if (recipient >= 0) slots.replaceAt(recipient, { phase: "open", index: -1 }) else slots,
      live' = live, op' = "acknowledge", socket' = h, id' = i, index' = n,
      released' = recipient >= 0, rejected' = false,
      releasedSocket' = if (recipient >= 0) recipient.idiv(3) else -1,
      releasedIndex' = if (recipient >= 0) slots[recipient].index else -1,
      releasedId' = if (recipient >= 0) (if (recipient < 3) recipient else 0) else -1,
    }
  }
  action close(h, i) = all {
    h == 0 or i == 0, Set("open", "waiting", "closed").contains(slots[key(h, i)].phase),
    event("close", h, i, -1, slots.replaceAt(key(h, i), { phase: "closed", index: -1 }), slots[key(h, i)].phase == "waiting"),
  }
  action retire(h) = all {
    live[h],
    slots' = List(0, 1, 2, 3).foldl(List(), (xs, k) => xs.append(if (k.idiv(3) == h and slots[k].phase != "new") { phase: "closed", index: -1 } else slots[k])),
    live' = live.replaceAt(h, false), op' = "retire", socket' = h, id' = -1, index' = -1,
    released' = false, rejected' = slots.indices().exists(k => k.idiv(3) == h and slots[k].phase == "waiting"), releasedSocket' = -1, releasedIndex' = -1, releasedId' = -1,
  }
  action step = {
    nondet h = Set(0, 1).oneOf()
    nondet i = Set(0, 1, 2).oneOf()
    nondet n = Set(0, 1, 2).oneOf()
    any { open(h, i), wait(h, i, n), acknowledge(h, i, n), close(h, i), retire(h) }
  }
  val capacity = Set(0, 1).forall(h => active(slots, h) <= 2)
  val socketAuthority = not(released) or releasedSocket == socket
  val indexAuthority = not(released) or releasedIndex == index
  val requestAuthority = not(released) or releasedId == id
  val retiredOwnership = Set(0, 1).forall(h => live[h] or active(slots, h) == 0)
  val safety = capacity and socketAuthority and indexAuthority and requestAuthority and retiredOwnership
  val capacityDenied = op == "open" and rejected and slots[key(socket, id)].phase == "new" and active(slots, socket) == 2
  val wrongSocket = op == "acknowledge" and (socket == 1 or id == 0) and slots[key(1 - socket, id)].phase == "waiting" and slots[key(1 - socket, id)].index == index and not(released)
  val wrongIndex = op == "acknowledge" and (socket == 0 or id == 0) and slots[key(socket, id)].phase == "waiting" and slots[key(socket, id)].index != index
  val duplicateWait = op == "wait" and rejected and slots[key(socket, id)].phase == "waiting"
  val retirementCancelled = op == "retire" and rejected
  val capacityReused = op == "open" and not(rejected) and slots.indices().exists(k => k.idiv(3) == socket and slots[k].phase == "closed")
}
