# Runtime dependency notices

The checked-in files in this directory carry the full licence texts selected
for the production dependencies shipped in Herdr World binary bundles:

- `npm-licenses.txt` covers the root and web production dependency closures;
- `cargo-licenses.html` covers the bridge dependency union for Linux x86-64,
  macOS ARM64, and macOS x86-64.

Generate them with pinned `generate-license-file` 4.2.3 and `cargo-about`
0.9.2:

```bash
npm run notices:generate
```

`npm run notices:check` regenerates into a temporary directory, compares the
bytes, and independently checks that every resolved production package/crate
and no unrelated component appears in the corresponding notice file.

These files are an attribution and licence inventory for release assembly;
they are not a vulnerability report or a claim of legal advice.
