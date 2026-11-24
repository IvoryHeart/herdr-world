### Changed

- Needs you shows the questions another World instance on the same runtime holds, when both share a local instance registry. Answering or dismissing one closes it in that World, exactly once; the answer still reaches the agent through that World's own connection.
- An owner alert now says which World holds the question. A World that cannot read that question shows "Asked in <World>" with a link instead of nothing.
