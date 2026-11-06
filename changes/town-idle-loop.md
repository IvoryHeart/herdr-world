### Fixed

- Stop idle Town from re-rendering the whole World page on every animation
  frame. An idle Town now renders only when its data changes, which saves
  battery on phones and frees the main thread for input.
