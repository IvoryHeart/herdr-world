# File preview recovery evidence

PR #413 contains render failures from a stale file or agent-worktree selection
inside the shared file preview. The surrounding window and Chat draft remain
mounted. Retry preview can recover after refreshing the worktree; choosing
another file or a current binding also clears the failed preview.

[Immutable five-context gallery](https://github.com/IvoryHeart/herdr-world/blob/7a8868192f45d37843485505cefda0e8a9d01967/screenshots/411-file-preview-recovery/README.md), published through the
GitHub API on `pr-assets/411-file-preview-recovery` at `7a8868192f45d37843485505cefda0e8a9d01967`.
The captured product source is `24bf581c9a107b26101ab7121afd7ae800373fb9`.

| Context | CSS viewport | Synthetic recovery capture |
| --- | --- | --- |
| Phone | 390 × 844 | [Unavailable notice and recovery controls](https://github.com/IvoryHeart/herdr-world/blob/7a8868192f45d37843485505cefda0e8a9d01967/screenshots/411-file-preview-recovery/phone-390x844.png) |
| Mac laptop size | 1512 × 982 | [Unavailable notice and recovery controls](https://github.com/IvoryHeart/herdr-world/blob/7a8868192f45d37843485505cefda0e8a9d01967/screenshots/411-file-preview-recovery/mac-laptop-1512x982.png) |
| Half-width Linux | 1280 × 1440 | [Unavailable notice and recovery controls](https://github.com/IvoryHeart/herdr-world/blob/7a8868192f45d37843485505cefda0e8a9d01967/screenshots/411-file-preview-recovery/half-linux-1280x1440.png) |
| Wide Linux | 2560 × 1440 | [Unavailable notice and recovery controls](https://github.com/IvoryHeart/herdr-world/blob/7a8868192f45d37843485505cefda0e8a9d01967/screenshots/411-file-preview-recovery/wide-linux-2560x1440.png) |
| Portrait | 1440 × 2560 | [Unavailable notice and recovery controls](https://github.com/IvoryHeart/herdr-world/blob/7a8868192f45d37843485505cefda0e8a9d01967/screenshots/411-file-preview-recovery/portrait-1440x2560.png) |

![Phone 390×844: actual preview recovery controls in a synthetic Files and Chat frame](https://raw.githubusercontent.com/IvoryHeart/herdr-world/7a8868192f45d37843485505cefda0e8a9d01967/screenshots/411-file-preview-recovery/phone-390x844.png)

The fixture renders production `FilePreviewContent`, its error boundary and
production tokens/base/preview styles in a minimal synthetic Files/Chat frame.
A missing current agent-worktree target triggers the real strict URL error.
The frame supplies the existing Files/back and Close actions so all recovery
controls are visible. It is component evidence, not a complete live Inspector.

All five contexts pass checks for viewport dimensions, no horizontal document
overflow, and visible, hit-testable Retry preview, Files/back and Close preview
controls. At each size stale retry remains contained, back/close invoke their
callbacks, and retry with a synthetic current binding restores the preview
without changing the example Chat draft. The gallery includes the machine-readable
[receipt](https://github.com/IvoryHeart/herdr-world/blob/7a8868192f45d37843485505cefda0e8a9d01967/screenshots/411-file-preview-recovery/receipt.json).

Captures use Chromium on Linux at device scale factor 1. Native Mac, phone,
live Herdr and SSH behavior are not claimed. No protected service listener was
used or changed. The screenshots remain on the asset branch, not in the product
diff.
