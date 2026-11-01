### Fixed

- Keep Chat paperclip uploads working when browser sync reconnects while the file
  chooser is open or between files in a multi-file selection, provided the same
  conversation and runtime still own the draft. Refuse a changed target before
  uploading remaining files, retaining completed paths in the original draft.
