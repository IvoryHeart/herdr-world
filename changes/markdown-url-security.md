### Fixed

- Reject Markdown link and image URLs that hide unsafe schemes with controls or
  use mixed slashes to address another origin. Preserve ordinary links and
  workspace source-file navigation. Adapted from [Roamgate #567](https://github.com/powerfooI/roamgate/pull/567),
  commit `ded99da2f6ccf8ed3fa85ae29e27011598ec4b04`.
