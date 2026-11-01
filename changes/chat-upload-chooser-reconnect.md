### Fixed

- Keep Chat paperclip uploads working when browser sync reconnects while the file
  chooser is open, provided the same conversation and runtime still own the draft.
  Refuse the selection if its target changes while choosing files.
