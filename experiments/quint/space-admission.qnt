module space_admission {
  pure val BROKEN = false
  pure val IDS = Set(0, 1, 2, 3, 4, 5)
  // Dense host 0, medium host 1, sparse host 2. IDs are input positions.
  pure val HOSTS = List(0, 0, 0, 1, 1, 2)
  var present: Set[int]
  var relevant: Set[int]
  var bound: int
  var admitted: Set[int]
  var op: str
  pure def earlier(xs, i) = xs.filter(j => j < i).size()
  pure def localRank(xs, i) = earlier(xs.filter(j => HOSTS[j] == HOSTS[i]), i)
  pure def first(xs, i) = xs.filter(j => HOSTS[j] == HOSTS[i]).fold(7, (best, j) => if (j < best) j else best)
  pure def precedes(xs, j, i) = localRank(xs, j) < localRank(xs, i)
    or (localRank(xs, j) == localRank(xs, i) and first(xs, j) < first(xs, i))
  pure def expected(xs, rs, cap) = {
    val ordinary = xs.exclude(rs)
    val reserved = rs.filter(i => earlier(rs, i) < cap)
    reserved.union(ordinary.filter(i =>
      ordinary.filter(j => precedes(ordinary, j, i)).size() < cap - reserved.size()))
  }
  action init = all {
    present' = Set(), relevant' = Set(), bound' = 0, admitted' = Set(), op' = "init",
  }
  action step = {
    nondet xs = IDS.powerset().oneOf()
    nondet rs = xs.powerset().oneOf()
    nondet cap = 0.to(6).oneOf()
    all {
      present' = xs, relevant' = rs, bound' = cap, op' = "allocate",
      admitted' = if (BROKEN) xs.filter(i => earlier(xs, i) < cap)
        else expected(xs, rs, cap),
    }
  }
  // Allocation is stateless. Enumerate configurations as initial states and
  // self-loop for verification, avoiding an irrelevant complete transition graph.
  action allConfigurations = step
  action hold = all {
    present' = present, relevant' = relevant, bound' = bound,
    admitted' = admitted, op' = op,
  }
  val withinBound = admitted.size() <= bound and admitted.subseteq(present)
  val respectsPriority = relevant.filter(i => earlier(relevant, i) < bound).subseteq(admitted)
  val fairSelection = admitted == expected(present, relevant, bound)
  val safety = withinBound and respectsPriority and fairSelection
  val mixedPriority = relevant.size() > 0 and admitted.exclude(relevant).size() > 0
  val allHosts = Set(0, 1, 2).forall(h => admitted.exists(i => HOSTS[i] == h))
}
