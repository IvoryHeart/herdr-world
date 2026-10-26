### Fixed

- Preserve native Ctrl+Shift+V terminal text paste on plain-HTTP LAN addresses
  in Windows/Linux browsers, while keeping async image paste over HTTPS or
  localhost. Use Ctrl+V or drag and drop for images on plain HTTP. Custom paste
  shortcuts now explain the native paste, drag-and-drop and HTTPS alternatives
  when clipboard reads are unavailable.
