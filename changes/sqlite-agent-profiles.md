### Changed

- Store agent profiles and chimes in the World database, importing existing JSON
  once after a private backup. Profile edits, terminal import completion and the
  Town master revision watermark now commit through the single SQLite writer.
