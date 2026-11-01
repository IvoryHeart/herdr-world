# Reference fonts

Fixture-only, Latin/punctuation WOFF2 subsets of Noto Sans regular/bold
(Noto Sans 2.004) and DejaVu Sans Mono regular/bold (2.37).
Sources: [Noto fonts](https://github.com/notofonts/noto-fonts) and
[DejaVu fonts](https://dejavu-fonts.github.io/). Original copyright and licence
texts accompany these assets.

These reproduce the reference Linux fallback faces without depending on installed
fonts. The fixture calls Noto Sans "Golden Sans" and aliases DejaVu Sans Mono to
"Silkscreen" solely to resolve Town's existing pixel-font stack deterministically.
They are test inputs, never imported into the application entry point.

Sans subsets retain U+0020–007E, U+2000–206F, U+00D7 and U+00B7 plus supported
arrows. Mono subsets include U+2000–2BFF; the symbols subset supplies U+2190–2BFF
in the sans stack too, including the completed-agent checkmark. FontTools'
subsetter converts the original faces to WOFF2; no font-generation tool is needed
to run the harness.
