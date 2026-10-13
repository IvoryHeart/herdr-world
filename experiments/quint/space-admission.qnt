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
  var caseIndex: int
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
    present' = Set(), relevant' = Set(), bound' = 0, admitted' = Set(), op' = "init", caseIndex' = -1,
  }
  action step = {
    nondet xs = IDS.powerset().oneOf()
    nondet rs = xs.powerset().oneOf()
    nondet cap = 0.to(6).oneOf()
    all {
      present' = xs, relevant' = rs, bound' = cap, op' = "allocate", caseIndex' = -1,
      admitted' = if (BROKEN) xs.filter(i => earlier(xs, i) < cap)
        else expected(xs, rs, cap),
    }
  }
  // Allocation is stateless. Enumerate configurations as initial states and
  // self-loop for verification, avoiding an irrelevant complete transition graph.
  action allConfigurations = step
  action hold = all {
    present' = present, relevant' = relevant, bound' = bound,
    admitted' = admitted, op' = op, caseIndex' = caseIndex,
  }
  // Each ternary digit selects absent/ordinary/relevant; capacity is the low
  // base-seven digit. This enumerates every configuration exactly once for replay.
  pure val POWERS = List(1, 3, 9, 27, 81, 243)
  pure def trit(index, i) = index.idiv(7).idiv(POWERS[i]).imod(3)
  action enumerate = {
    val index = caseIndex + 1
    val xs = IDS.filter(i => trit(index, i) > 0)
    val rs = IDS.filter(i => trit(index, i) == 2)
    val cap = index.imod(7)
    all {
      caseIndex < 5102,
      caseIndex' = index, present' = xs, relevant' = rs, bound' = cap,
      admitted' = expected(xs, rs, cap), op' = "allocate",
    }
  }
  val withinBound = admitted.size() <= bound and admitted.subseteq(present)
  val respectsPriority = relevant.filter(i => earlier(relevant, i) < bound).subseteq(admitted)
  val fairSelection = admitted == expected(present, relevant, bound)
  // Independent properties constrain results without calling expected().
  val fillsCapacity = admitted.size() == (if (bound < present.size()) bound else present.size())
  val hostPrefix = admitted.exclude(relevant).forall(i =>
    present.exclude(relevant).filter(j => HOSTS[j] == HOSTS[i] and j < i).subseteq(admitted))
  val roundFairness = Set(0, 1, 2).forall(a => Set(0, 1, 2).forall(b =>
    not(present.exclude(relevant).exclude(admitted).exists(i => HOSTS[i] == a))
    or admitted.exclude(relevant).filter(i => HOSTS[i] == b).size()
      <= admitted.exclude(relevant).filter(i => HOSTS[i] == a).size() + 1))
  val safety = withinBound and respectsPriority and fairSelection and fillsCapacity and hostPrefix and roundFairness
  val mixedPriority = relevant.size() > 0 and admitted.exclude(relevant).size() > 0
  val allHosts = Set(0, 1, 2).forall(h => admitted.exists(i => HOSTS[i] == h))
}
