import type { IBufferLine, ILink, Terminal } from "@xterm/xterm";
import { terminalLinkModifierMatches } from "./shortcutPreferences";
import {
  findTerminalHttpLinks,
  sanitizeTerminalHttpUrl,
} from "./terminalLinks";
import {
  findTerminalFileLinkCandidates,
  MAX_CANDIDATES_PER_LINE,
  type TerminalFileLinkCandidate,
  type TextRange,
} from "./terminalFileLinks";

const MAX_CONTEXT_CELLS = 16_384;
const MAX_INFERRED_JOINS = 8;
const PATH_EDGE = /^[A-Za-z0-9._~:@%+=,/-]$/;
type Position = { x: number; y: number };
type CellSpan = { start: Position; end: Position };

function lineTextWithCells(line: IBufferLine, cols: number, y: number) {
  const reusable = line.getCell(0);
  let text = "";
  const cells: CellSpan[] = [];
  for (let x = 0; x < Math.min(line.length, cols); x++) {
    const cell = line.getCell(x, reusable);
    if (!cell || cell.getWidth() === 0) continue;
    const chars = cell.getChars() || " ";
    const span = {
      start: { x: x + 1, y },
      end: { x: Math.min(cols, x + cell.getWidth()), y },
    };
    for (let i = 0; i < chars.length; i++) cells.push(span);
    text += chars;
  }
  return { text, cells, wrapped: line.isWrapped };
}

/** Reconstruct logical text while retaining xterm's cell-based coordinates. */
function readLinkContext(
  term: Terminal,
  row: number,
  inferContinuations: boolean,
) {
  const rows = new Map<number, ReturnType<typeof lineTextWithCells>>();
  const read = (y: number) => {
    if (rows.has(y)) return rows.get(y);
    const line = term.buffer.active.getLine(y - 1);
    if (!line) return undefined;
    const value = lineTextWithCells(line, term.cols, y);
    rows.set(y, value);
    return value;
  };
  const joins = (y: number) => {
    const previous = read(y - 1);
    const next = read(y);
    if (!previous || !next) return false;
    if (next.wrapped) return true;
    // Screen repaints have no soft-wrap metadata. TUI applications also wrap
    // prose with indentation/padding. These joins are only file candidates:
    // they must resolve to an existing file before becoming a link.
    return (
      inferContinuations &&
      !/https?:\/\/\S*$/i.test(previous.text.trimEnd()) &&
      PATH_EDGE.test(previous.text.trimEnd().slice(-1)) &&
      PATH_EDGE.test(next.text.trimStart().slice(0, 1))
    );
  };
  if (term.cols < 1 || term.cols > MAX_CONTEXT_CELLS || !read(row))
    return undefined;
  let first = row;
  let last = row;
  const withinBudget = () =>
    (last - first + 1) * term.cols <= MAX_CONTEXT_CELLS;
  let inferred = 0;
  while (first > 1 && joins(first)) {
    if (!read(first)!.wrapped && inferred++ >= MAX_INFERRED_JOINS) break;
    first--;
    if (!withinBudget()) return undefined;
  }
  inferred = 0;
  while (joins(last + 1)) {
    if (!read(last + 1)!.wrapped && inferred++ >= MAX_INFERRED_JOINS) break;
    last++;
    if (!withinBudget()) return undefined;
  }
  let text = "";
  const cells: CellSpan[] = [];
  const segments: TextRange[] = [];
  let segmentStart = 0;
  for (let y = first; y <= last; y++) {
    const line = read(y)!;
    const inferredBefore = y > first && !line.wrapped;
    const inferredAfter = y < last && !read(y + 1)!.wrapped;
    if (inferredBefore) {
      segments.push({ start: segmentStart, end: text.length });
      segmentStart = text.length;
    }
    const start = inferredBefore
      ? line.text.length - line.text.trimStart().length
      : 0;
    let end = inferredAfter ? line.text.trimEnd().length : line.text.length;
    // Wide glyphs and resizes can leave null padding before a soft wrap.
    // Remove only empty cells; explicit spaces remain token boundaries.
    if (y < last && read(y + 1)!.wrapped) {
      const source = term.buffer.active.getLine(y - 1)!;
      while (
        end > start &&
        !source.getCell(line.cells[end - 1]!.start.x - 1)?.getChars()
      )
        end--;
    }
    text += line.text.slice(start, end);
    cells.push(...line.cells.slice(start, end));
  }
  segments.push({ start: segmentStart, end: text.length });
  return { text, cells, segments };
}

function overlaps(a: TextRange, b: TextRange) {
  return a.start < b.end && a.end > b.start;
}

export function registerTerminalLinkProvider(
  term: Terminal,
  onPreviewPath?: (path: string) => void,
  resolvePaths?: (paths: string[]) => Promise<Map<string, string>>,
  inferContinuations: () => boolean = () => false,
) {
  let disposed = false;
  const registration = term.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const activeBuffer = term.buffer.active;
      const columnCount = term.cols;
      const infer = inferContinuations();
      const context = readLinkContext(term, bufferLineNumber, infer);
      if (!context) {
        callback(undefined);
        return;
      }
      const snapshot = JSON.stringify(context);
      const { text, cells, segments } = context;
      const rangeFor = (span: TextRange) => {
        const start = cells[span.start]?.start;
        const end = cells[span.end - 1]?.end;
        return start &&
          end &&
          start.y <= bufferLineNumber &&
          end.y >= bufferLineNumber
          ? { start, end }
          : undefined;
      };
      const links: ILink[] = [];
      // HTTP links use only real soft wraps. Heuristic joins cannot verify a URL.
      for (const segment of segments) {
        for (const match of findTerminalHttpLinks(
          text.slice(segment.start, segment.end),
        )) {
          const range = rangeFor({
            start: segment.start + match.start,
            end: segment.start + match.end,
          });
          if (!range) continue;
          links.push({
            range,
            text: match.url,
            activate(event, raw) {
              event.preventDefault();
              if (!terminalLinkModifierMatches(event)) return;
              const url = sanitizeTerminalHttpUrl(raw);
              if (url) window.open(url, "_blank", "noopener,noreferrer");
            },
          });
        }
      }
      const candidates: Array<
        TerminalFileLinkCandidate & { inferred: boolean }
      > = [];
      if (onPreviewPath) {
        // Exclude whole URLs as well as the individual row forms so a wrapped
        // URL's path fragment never becomes a local file link.
        const excluded = findTerminalHttpLinks(text);
        const add = (part: TextRange) => {
          for (const match of findTerminalFileLinkCandidates(
            text.slice(part.start, part.end),
          )) {
            const candidate = {
              ...match,
              start: part.start + match.start,
              end: part.start + match.end,
            };
            if (
              !rangeFor(candidate) ||
              excluded.some((span) => overlaps(candidate, span))
            )
              continue;
            if (
              candidates.some(
                (span) =>
                  span.start === candidate.start && span.end === candidate.end,
              )
            )
              continue;
            candidates.push({
              ...candidate,
              inferred: segments.some(
                (segment) =>
                  candidate.start < segment.end && candidate.end > segment.end,
              ),
            });
          }
        };
        add({ start: 0, end: text.length });
        if (segments.length > 1) {
          // A path may end before another prose row or start after one. Try
          // complete segment spans around the requested row, not just the
          // longest guessed token and individual fragments.
          for (let first = 0; first < segments.length; first++) {
            for (let last = first; last < segments.length; last++) {
              const span = {
                start: segments[first]!.start,
                end: segments[last]!.end,
              };
              if (rangeFor(span)) add(span);
            }
          }
        }
      }
      // Prefer the complete existing path; retain standalone row links when a
      // speculative join does not resolve. Validate ambiguous absolute fragments
      // too, instead of making a known partial path immediately clickable.
      candidates.sort((a, b) => b.end - b.start - (a.end - a.start));
      const needsResolution = (candidate: (typeof candidates)[number]) =>
        !candidate.absolute ||
        candidate.inferred ||
        candidates.some(
          (other) => other.inferred && overlaps(candidate, other),
        );
      const pending = candidates.filter(needsResolution);
      const finish = (resolved = new Map<string, string>()) => {
        if (disposed) return;
        if (
          term.buffer.active !== activeBuffer ||
          term.cols !== columnCount ||
          inferContinuations() !== infer ||
          JSON.stringify(readLinkContext(term, bufferLineNumber, infer)) !==
            snapshot
        ) {
          callback(undefined);
          return;
        }
        const accepted: TextRange[] = [];
        for (const candidate of candidates) {
          const path = needsResolution(candidate)
            ? resolved.get(candidate.path)
            : candidate.path;
          if (!path || accepted.some((span) => overlaps(candidate, span)))
            continue;
          accepted.push(candidate);
          links.push({
            range: rangeFor(candidate)!,
            text: candidate.path,
            activate(event) {
              event.preventDefault();
              if (terminalLinkModifierMatches(event)) onPreviewPath?.(path);
            },
          });
        }
        callback(links.length ? links : undefined);
      };
      if (!pending.length || !resolvePaths) {
        finish();
        return;
      }
      const resolveAll = async () => {
        const paths = [...new Set(pending.map((candidate) => candidate.path))];
        const resolved = new Map<string, string>();
        // Contexts can exceed the per-line cache and server batch limit.
        for (let i = 0; i < paths.length; i += MAX_CANDIDATES_PER_LINE) {
          if (disposed) break;
          const batch = await resolvePaths(
            paths.slice(i, i + MAX_CANDIDATES_PER_LINE),
          );
          for (const [candidate, path] of batch) resolved.set(candidate, path);
        }
        return resolved;
      };
      void resolveAll().then(finish, () => finish());
    },
  });
  return {
    dispose() {
      disposed = true;
      registration.dispose();
    },
  };
}
