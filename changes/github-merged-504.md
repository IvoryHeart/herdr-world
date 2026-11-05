### Fixed

- Keep the GitHub source connected when many pull requests merged in the
  window: merged history is read fifty at a time, apart from open work,
  instead of in one request that GitHub stopped with a timeout.
- Read open pull request searches separately and action details before history.
  History is bounded to 400 pull requests within the existing minute; an
  oversized or timed-out history keeps the last complete list and explains
  how to shorten the merged window. A pull request merged between requests
  keeps its merged state and date, together with all its roles.
