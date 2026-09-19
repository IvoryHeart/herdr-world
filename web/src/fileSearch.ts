import { Minimatch } from "minimatch";

type SearchEntry = { name: string; path: string };

/** Plain text is a substring; globs match the full filename or loaded path. */
export function createFileSearchMatcher(search: string) {
  const query = search.trim().replace(/\\/g, "/").toLowerCase();
  const substring = (entry: SearchEntry) =>
    [entry.name, entry.path].some((value) =>
      value.toLowerCase().includes(query),
    );
  let glob: Minimatch;
  try {
    glob = new Minimatch(query, {
      dot: true,
      nonegate: true,
      nocomment: true,
      magicalBraces: true,
      braceExpandMax: 128,
    });
  } catch {
    return substring;
  }
  if (!glob.hasMagic()) return substring;
  return (entry: SearchEntry) =>
    glob.match(
      (query.includes("/")
        ? entry.path.replace(/\\/g, "/")
        : entry.name
      ).toLowerCase(),
    );
}
