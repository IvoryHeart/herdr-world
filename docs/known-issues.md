# Known issues

- Dense synthetic browser tests intermittently exceed their input-latency budgets.
  Later complete CI runs passed with unchanged code and limits, but the causes of
  the earlier spikes remain unresolved. Investigation and a fix are planned for
  the release after 0.2.4: [issue #202](https://github.com/IvoryHeart/herdr-world/issues/202).
