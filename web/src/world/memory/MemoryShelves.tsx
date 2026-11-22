import { memoryHarness, memorySourceEditable } from "../../../../shared/memory";
import { BookOpen, FilePlus2, Plus } from "lucide-react";
import type {
  MemoryCatalog,
  MemoryEntry,
  MemorySearch,
  MemorySource,
} from "../../../../shared/memory";
import {
  agentDisplayName,
  agentLoad,
  entryKey,
  entryLoad,
  entryLoads,
  fileSourceName,
  formatAge,
  formatBytes,
  harnessLabel,
  KIND_LABELS,
  LOAD_LABELS,
  libraryWings,
  readerRows,
  sameReader,
  sharingText,
  shortPath,
  type MemoryAgentNames,
  type MemoryReader,
  type MemoryReaderRow,
} from "./memoryModel";
import { TOWN_LIBRARY_SPINES } from "../town/townLibraryPaint";

/**
 * The Library's left and middle (#1027): who reads (everything, a project,
 * an agent) and the shelves they read, as books with size, age and how
 * each agent loads them. An agent reader leads with what it would load.
 */

const readerValue = (reader: MemoryReader) =>
  reader.kind === "all" ? "all" : `${reader.kind}:${reader.id}`;

function readerFrom(value: string): MemoryReader {
  if (value === "all") return { kind: "all" };
  const [kind, ...rest] = value.split(":");
  return { kind: kind as "project" | "agent", id: rest.join(":") };
}

function ReaderButton({
  row,
  selected,
  onSelect,
  nested = false,
}: {
  row: MemoryReaderRow;
  selected: boolean;
  onSelect(reader: MemoryReader): void;
  nested?: boolean;
}) {
  return (
    <button
      type="button"
      className={`memory-reader${nested ? " is-agent" : ""}`}
      aria-pressed={selected}
      onClick={() => onSelect(row.reader)}
    >
      <span className="memory-reader-label">{row.label}</span>
      <span className="memory-reader-detail">{row.detail}</span>
      <span className="memory-reader-count" aria-label={`${row.files} files`}>
        {row.files}
        {row.stale ? (
          <span className="memory-stale-dot" title={`${row.stale} stale`} />
        ) : null}
      </span>
    </button>
  );
}

export function MemoryReaders({
  catalog,
  names,
  reader,
  onSelect,
}: {
  catalog: MemoryCatalog;
  names: MemoryAgentNames;
  reader: MemoryReader;
  onSelect(reader: MemoryReader): void;
}) {
  const rows = readerRows(catalog, names);
  return (
    <>
      <nav className="memory-readers" aria-label="Who reads">
        {rows.map((row) => (
          <div key={readerValue(row.reader)} className="memory-reader-group">
            <ReaderButton
              row={row}
              selected={sameReader(row.reader, reader)}
              onSelect={onSelect}
            />
            {row.agents?.map((agent) => (
              <ReaderButton
                key={readerValue(agent.reader)}
                row={agent}
                nested
                selected={sameReader(agent.reader, reader)}
                onSelect={onSelect}
              />
            ))}
          </div>
        ))}
        {catalog.unsupported.length ? (
          <p className="memory-unsupported">
            {catalog.unsupported.map((item) => {
              const agent = catalog.agents.find((a) => a.id === item.agent_id);
              const name = agent
                ? agentDisplayName(agent, names)
                : (names[item.agent_id] ?? item.agent_id);
              return (
                <span key={item.agent_id}>
                  {name}: {item.reason}
                </span>
              );
            })}
          </p>
        ) : null}
      </nav>
      <label className="memory-reader-select">
        <span>Who reads</span>
        <select
          value={readerValue(reader)}
          onChange={(event) => onSelect(readerFrom(event.target.value))}
        >
          {rows.map((row) =>
            row.agents ? (
              <optgroup key={readerValue(row.reader)} label={row.label}>
                <option value={readerValue(row.reader)}>
                  {row.label} — whole project ({row.files})
                </option>
                {row.agents.map((agent) => (
                  <option
                    key={readerValue(agent.reader)}
                    value={readerValue(agent.reader)}
                  >
                    {agent.label} · {agent.detail} ({agent.files})
                  </option>
                ))}
              </optgroup>
            ) : (
              <option key="all" value="all">
                {row.label} ({row.files})
              </option>
            ),
          )}
        </select>
      </label>
    </>
  );
}

function AgentLoadCard({
  catalog,
  agentId,
  names,
}: {
  catalog: MemoryCatalog;
  agentId: string;
  names: MemoryAgentNames;
}) {
  const load = agentLoad(catalog, agentId);
  if (!load) return null;
  const unsupported = catalog.unsupported.find(
    (item) => item.agent_id === agentId,
  );
  return (
    <section className="memory-agent-load" aria-label="What it will load">
      <h4>
        {agentDisplayName(load.agent, names)}{" "}
        <span>{harnessLabel(load.agent.harness)}</span>
      </h4>
      {unsupported ? (
        <p>{unsupported.reason}</p>
      ) : (
        <ul>
          <li>
            <b>{load.startup.length}</b> at start
            {load.startup.length ? ` · ${formatBytes(load.startupBytes)}` : ""}
          </li>
          <li>
            <b>{load.onDemand.length}</b> when needed
          </li>
          {load.skipped.length ? (
            <li>
              <b>{load.skipped.length}</b> skipped
            </li>
          ) : null}
        </ul>
      )}
      <p className="memory-hint">
        What it would load next time it starts here, not what it holds now.
      </p>
    </section>
  );
}

function Book({
  entry,
  harness,
  selected,
  onOpen,
  index,
}: {
  entry: MemoryEntry;
  harness: string | null | undefined;
  selected: boolean;
  onOpen(entry: MemoryEntry): void;
  index: number;
}) {
  const own = harness === undefined ? null : entryLoad(entry, harness);
  const loads = own
    ? [{ harness: harness!, label: harnessLabel(harness), mode: own }]
    : entryLoads(entry);
  return (
    <li>
      <button
        type="button"
        className={`memory-book-row${entry.stale ? " is-stale" : ""}`}
        aria-current={selected ? "true" : undefined}
        onClick={() => onOpen(entry)}
        style={
          {
            "--memory-spine":
              TOWN_LIBRARY_SPINES[index % TOWN_LIBRARY_SPINES.length],
          } as React.CSSProperties
        }
      >
        <span className="memory-spine" aria-hidden="true" />
        <span className="memory-book-name">{entry.path}</span>
        <span className="memory-book-facts">
          {formatBytes(entry.size)} · {entry.stale ? "stale, " : ""}
          {formatAge(entry.age_ms)}
        </span>
        <span className="memory-book-loads">
          {entry.state === "refused" ? (
            <span className="memory-load is-refused">Refused</span>
          ) : (
            loads.map((load) => (
              <span
                key={load.harness}
                className={`memory-load is-${load.mode}`}
                title={`${load.label}: ${LOAD_LABELS[load.mode]}`}
              >
                {loads.length > 1 ? `${load.label}: ` : ""}
                {LOAD_LABELS[load.mode]}
              </span>
            ))
          )}
        </span>
      </button>
    </li>
  );
}

export function MemoryShelves({
  catalog,
  names,
  reader,
  selected,
  onOpen,
  onAdd,
}: {
  catalog: MemoryCatalog;
  names: MemoryAgentNames;
  reader: MemoryReader;
  selected: string | null;
  onOpen(source: MemorySource, entry: MemoryEntry): void;
  onAdd(source: MemorySource, path: string | null): void;
}) {
  const wings = libraryWings(catalog, reader);
  const harness =
    reader.kind === "agent"
      ? (catalog.agents.find((a) => a.id === reader.id)?.harness ?? null)
      : undefined;
  let spine = 0;
  return (
    <div className="memory-shelves">
      {reader.kind === "agent" ? (
        <AgentLoadCard catalog={catalog} agentId={reader.id} names={names} />
      ) : null}
      {wings.length === 0 ? (
        <p className="memory-empty-state">
          <BookOpen size={18} aria-hidden="true" /> No memory files here yet.
        </p>
      ) : null}
      {wings.map((wing) => (
        <section
          key={wing.scope}
          className="memory-wing"
          aria-label={wing.title}
        >
          <h4>
            {wing.title} <span>{wing.hint}</span>
          </h4>
          {wing.shelves.map(({ source, entries, bytes }) => (
            <div
              key={source.id}
              className={`memory-shelf is-${source.state}`}
              aria-label={`Shelf ${shortPath(source.path)}`}
            >
              <div className="memory-shelf-head">
                <span className={`memory-kind is-${source.kind}`}>
                  {KIND_LABELS[source.kind]}
                </span>
                <span className="memory-shelf-name" title={source.path}>
                  {shortPath(source.path)}
                </span>
                <span className="memory-shelf-harness">
                  {source.harnesses.map(harnessLabel).join(" · ")}
                </span>
                {source.state === "available" &&
                source.shape === "directory" &&
                memorySourceEditable(source) ? (
                  <button
                    type="button"
                    className="ghost memory-add"
                    onClick={() => onAdd(source, null)}
                    aria-label={`Add a note to ${shortPath(source.path)}`}
                    title="Add a note"
                  >
                    <Plus size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <p className="memory-hint">
                {source.details[
                  memoryHarness(harness) ?? source.harnesses[0]!
                ] ?? source.description}
              </p>
              <p className="memory-shelf-sharing">
                {sharingText(source, catalog, names)}
                {entries.length > 1
                  ? ` · ${entries.length} files, ${formatBytes(bytes)}`
                  : ""}
              </p>
              {source.state === "refused" ? (
                <p className="memory-refused">
                  {source.reason ?? "World won't open it."}
                </p>
              ) : source.state === "missing" && source.shape === "file" ? (
                <button
                  type="button"
                  className="memory-create"
                  onClick={() => onAdd(source, fileSourceName(source))}
                >
                  <FilePlus2 size={14} aria-hidden="true" /> Create{" "}
                  {fileSourceName(source)}
                </button>
              ) : source.state === "missing" && memorySourceEditable(source) ? (
                // A fresh project has no auto-memory folder yet; the first
                // note creates it (the API makes a missing source folder).
                <button
                  type="button"
                  className="memory-create"
                  onClick={() => onAdd(source, null)}
                >
                  <FilePlus2 size={14} aria-hidden="true" /> Add the first note
                </button>
              ) : entries.length === 0 ? (
                <p className="memory-hint">Empty shelf.</p>
              ) : (
                <ul className="memory-books">
                  {entries.map((entry) => (
                    <Book
                      key={entry.id}
                      entry={entry}
                      harness={harness}
                      index={spine++}
                      selected={selected === entryKey(entry)}
                      onOpen={(chosen) => onOpen(source, chosen)}
                    />
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

export function MemorySearchResults({
  search,
  catalog,
  onOpen,
  onClear,
}: {
  search: MemorySearch;
  catalog: MemoryCatalog;
  onOpen(source: MemorySource, entry: MemoryEntry, line: number): void;
  onClear(): void;
}) {
  return (
    <div className="memory-shelves">
      <div className="memory-search-head" role="status">
        <span>
          {search.matches.length} line{search.matches.length === 1 ? "" : "s"}{" "}
          with “{search.query}”{search.truncated ? " (first ones only)" : ""}
          {search.skipped ? ` · ${search.skipped} files skipped` : ""}
        </span>
        <button type="button" className="ghost" onClick={onClear}>
          Back to shelves
        </button>
      </div>
      <ul className="memory-matches">
        {search.matches.map((match) => {
          const source = catalog.sources.find(
            (s) => s.id === match.entry.source_id,
          );
          return (
            <li key={`${entryKey(match.entry)}:${match.line}`}>
              <button
                type="button"
                className="memory-match"
                disabled={!source}
                onClick={() =>
                  source && onOpen(source, match.entry, match.line)
                }
              >
                <span className="memory-book-name">
                  {match.entry.path}
                  <span>:{match.line}</span>
                </span>
                <span className="memory-match-excerpt">{match.excerpt}</span>
                {source ? (
                  <span className="memory-book-facts" title={source.path}>
                    {shortPath(source.path)}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
