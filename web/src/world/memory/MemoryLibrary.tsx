import { memoryHarness } from "../../../../shared/memory";
import { RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MemoryEntry,
  MemorySearch,
  MemorySource,
} from "../../../../shared/memory";
import { PlaceWindow } from "../PlaceWindow";
import { townLibraryBanner } from "../town/townLibraryPaint";
import { MemoryBook, type MemoryBookOpen } from "./MemoryBook";
import type { ShelvedArtefact } from "../../../../shared/agentArtefacts";
import {
  ArtefactReader,
  ArtefactShelfList,
  type ArtefactRoute,
} from "./LibraryArtefacts";
import {
  artefactShelfState,
  requestArtefactShelf,
  useArtefactShelves,
} from "./artefactShelfClient";
import { readerArtefacts, searchArtefacts } from "./artefactShelfModel";
import {
  memoryCatalogState,
  memoryClient,
  memoryErrorText,
  memoryHosts,
  memoryTargetKey,
  requestMemoryCatalog,
  useMemoryStore,
  type MemoryFilter,
} from "./memoryClient";
import type { MemoryLibraryRequest } from "./memoryEvents";
import { memoryFixtureOn } from "./memoryFixture";
import {
  ALL_READERS,
  entryKey,
  formatAge,
  type MemoryReader,
} from "./memoryModel";
import {
  MemoryReaders,
  MemorySearchResults,
  MemoryShelves,
} from "./MemoryShelves";
import "./memoryLibrary.css";

/**
 * The Library (#1027): every agent's and project's memory on one host, as
 * shelves of books. Opened from Town's library, the town center ring,
 * Board's hub or an agent's settings (memoryEvents.ts). It reads and writes
 * only through that host's connection and generation; contents live in this
 * dialog's state and leave with it. Desktop shows readers, shelves and the
 * open book side by side; a phone shows one at a time with Back.
 *
 * The chosen host is explicit (the request's, or the one picked in Host):
 * when its connection goes away the Library says so and never falls through
 * to another host, whose agents may share native IDs. Any host or reader
 * change retires replies still in flight (catalog, search, book).
 */

type Pane = "shelves" | "book";

function initialReader(request: MemoryLibraryRequest): MemoryReader {
  if (request.agentId) return { kind: "agent", id: request.agentId };
  if (request.workspaceId) return { kind: "project", id: request.workspaceId };
  return ALL_READERS;
}

const NO_ROUTE: ArtefactRoute = {
  workspace: () => null,
  openInFiles: () => null,
};

export function MemoryLibrary({
  request,
  onClose,
  route = NO_ROUTE,
}: {
  request: MemoryLibraryRequest;
  onClose(): void;
  /** How a made file is read and opened in Files on its host. */
  route?: ArtefactRoute;
}) {
  useMemoryStore();
  useArtefactShelves();
  const hosts = memoryHosts();
  // Only an open with no host named, before any host is known, takes the
  // first one to appear; a named or picked host is never replaced silently.
  // The testing switch has one synthetic host, which stands for any named one.
  const [hostId, setHostId] = useState<string | null>(() =>
    memoryFixtureOn()
      ? (hosts[0]?.connection_id ?? null)
      : (request.connectionId ?? hosts[0]?.connection_id ?? null),
  );
  useEffect(() => {
    if (hostId === null && hosts[0]) setHostId(hosts[0].connection_id);
  }, [hostId, hosts]);
  const host =
    hosts.find((candidate) => candidate.connection_id === hostId) ?? null;
  const hostLabel = useRef<string | null>(null);
  if (host) hostLabel.current = host.label;
  const hostKey = host ? memoryTargetKey(host) : null;
  const state = host ? memoryCatalogState(host) : null;
  const catalog = state?.catalog ?? null;
  const [reader, setReader] = useState<MemoryReader>(() =>
    initialReader(request),
  );
  const [book, setBook] = useState<MemoryBookOpen | null>(null);
  // The "Made by agents" wing (#1327): its shelf, the picked one and matches.
  const [wing, setWing] = useState(request.wing ?? "memory");
  const shelf = host ? (artefactShelfState(host)?.shelf ?? null) : null;
  const [made, setMade] = useState<ShelvedArtefact | null>(null);
  const [madeFound, setMadeFound] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("shelves");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<MemorySearch | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchToken = useRef(0);

  // Opening reads the host fresh; another host (or generation), or losing
  // it, starts over and retires a search still under way.
  useEffect(() => {
    searchToken.current += 1;
    setSearching(false);
    setSearchError(null);
    setBook(null);
    setMade(null);
    setMadeFound(null);
    setSearch(null);
    setPane("shelves");
    if (host) void requestMemoryCatalog(host, { force: true });
    if (host) void requestArtefactShelf(host, { force: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostKey]);

  // Another reader (picked, or a gone one replaced) retires a search still
  // under way, so its matches never show under the new reader.
  const readerKey =
    reader.kind === "all" ? "all" : `${reader.kind}:${reader.id}`;
  useEffect(() => {
    searchToken.current += 1;
    setSearching(false);
    setSearchError(null);
    setSearch(null);
    setMadeFound(null);
  }, [readerKey]);

  // The made thing asked for opens once the shelf has it (after the resets
  // above, which run first on open).
  const [wanted, setWanted] = useState(request.artefactId ?? null);
  useEffect(() => {
    const found = wanted && shelf?.artefacts.find((one) => one.id === wanted);
    if (!found) return;
    setWanted(null);
    setMade(found);
    setPane("book");
  }, [wanted, shelf]);

  // A reader the host doesn't have (gone, or another host's) shows everything;
  // the testing switch maps any agent to its first one. One that made things
  // on this host's shelf stays (#1327), so it is kept until the shelf is read.
  const shelfStatus = host ? artefactShelfState(host)?.status : "none";
  const shelfRead =
    shelfStatus === "ready" ||
    shelfStatus === "failed" ||
    shelfStatus === "none";
  useEffect(() => {
    if (!catalog || reader.kind === "all" || !shelfRead) return;
    if (readerArtefacts(shelf?.artefacts ?? [], reader).length) return;
    const known =
      reader.kind === "project"
        ? catalog.agents.some(
            (a) => a.project_id === reader.id && memoryHarness(a.harness),
          )
        : catalog.agents.some(
            (a) => a.id === reader.id && memoryHarness(a.harness),
          );
    if (known) return;
    const first = catalog.agents[0];
    setReader(
      memoryFixtureOn() && reader.kind === "agent" && first
        ? { kind: "agent", id: first.id }
        : ALL_READERS,
    );
  }, [catalog, reader, shelf, shelfRead]);

  // A book whose file left the catalog (deleted elsewhere) closes.
  const live = useMemo(() => {
    if (!book || book.kind !== "entry" || !catalog) return book;
    const entry = catalog.entries.find(
      (e) => entryKey(e) === entryKey(book.entry),
    );
    const source = catalog.sources.find((s) => s.id === book.source.id);
    return entry && source ? { ...book, entry, source } : null;
  }, [book, catalog]);

  const refresh = () => {
    if (!host) return;
    void requestMemoryCatalog(host, { force: true });
    void requestArtefactShelf(host, { force: true });
  };
  const project = (id: string | null) =>
    id === null
      ? null
      : (catalog?.projects.find((p) => p.id === id)?.label ??
        host?.rooms?.[id] ??
        null);
  const shelved = readerArtefacts(shelf?.artefacts ?? [], reader);
  const madeMatches =
    madeFound === null
      ? []
      : searchArtefacts(shelved, madeFound, host?.names, project);
  const openMade = (artefact: ShelvedArtefact) => {
    setBook(null);
    setMade(artefact);
    setPane("book");
  };

  const runSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const words = query.trim();
    if (!host || !words) return;
    const filter: MemoryFilter =
      reader.kind === "agent"
        ? { agent_id: reader.id }
        : reader.kind === "project"
          ? { workspace_id: reader.id }
          : {};
    const mine = ++searchToken.current;
    setMadeFound(words);
    setSearching(true);
    setSearchError(null);
    memoryClient()
      .search(host, words, filter)
      .then(
        (result) => {
          if (mine !== searchToken.current) return;
          setSearch(result);
          setPane("shelves");
        },
        (error: unknown) => {
          if (mine === searchToken.current)
            setSearchError(memoryErrorText(error));
        },
      )
      .finally(() => {
        if (mine === searchToken.current) setSearching(false);
      });
  };

  const openEntry = (
    source: MemorySource,
    entry: MemoryEntry,
    line?: number,
  ) => {
    setMade(null);
    setBook({ kind: "entry", source, entry, line });
    setPane("book");
  };
  const banner = useMemo(() => townLibraryBanner(), []);

  return (
    <PlaceWindow
      name="library"
      label="Library"
      className="memory-library"
      data-pane={pane}
      closeLabel="Close library"
      onClose={onClose}
      title={
        <div className="memory-title">
          {banner ? (
            <img src={banner} alt="" className="memory-banner" />
          ) : null}
          <div>
            <h2>Library</h2>
            <p>What your agents and projects remember</p>
          </div>
        </div>
      }
    >
      {!host && hostId !== null ? (
        <div className="memory-empty-state memory-gone" role="status">
          <p>
            {hostLabel.current ?? "This host"} is no longer connected, so its
            memory is unavailable here.
          </p>
          {hosts.length ? (
            <div className="memory-actions">
              {hosts.map((candidate) => (
                <button
                  key={candidate.connection_id}
                  type="button"
                  onClick={() => {
                    setHostId(candidate.connection_id);
                    setReader(ALL_READERS);
                  }}
                >
                  Open {candidate.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : !host ? (
        <p className="memory-empty-state">
          No connected host to read memory from. Connect one in Hosts, then open
          the Library again.
        </p>
      ) : (
        <>
          <div className="memory-toolbar">
            {hosts.length > 1 ? (
              <label className="memory-host">
                <span>Host</span>
                <select
                  value={host.connection_id}
                  onChange={(event) => {
                    setHostId(event.target.value);
                    setReader(ALL_READERS);
                  }}
                >
                  {hosts.map((candidate) => (
                    <option
                      key={candidate.connection_id}
                      value={candidate.connection_id}
                    >
                      {candidate.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="memory-host-name">{host.label}</span>
            )}
            <form className="memory-search" role="search" onSubmit={runSearch}>
              <input
                type="search"
                value={query}
                maxLength={200}
                placeholder="Search memory and what agents made"
                aria-label="Search memory"
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                type="submit"
                disabled={!query.trim() || searching}
                aria-label="Search"
              >
                <Search size={14} aria-hidden="true" />
              </button>
            </form>
            <button
              type="button"
              className="ghost memory-refresh"
              onClick={refresh}
              disabled={state?.status === "loading"}
              aria-label="Read again"
              title="Read again from the host"
            >
              <RefreshCw
                size={14}
                aria-hidden="true"
                className={
                  state?.status === "loading" ? "is-spinning" : undefined
                }
              />
            </button>
          </div>
          {state?.status === "failed" ? (
            <div className="memory-notice is-error" role="alert">
              <span>Couldn't read this host's memory: {state.error}</span>
              <button type="button" onClick={refresh}>
                Try again
              </button>
            </div>
          ) : null}
          {searchError ? (
            <div className="memory-notice is-error" role="alert">
              <span>Search failed: {searchError}</span>
            </div>
          ) : null}
          {!catalog ? (
            <p className="memory-empty-state" aria-busy="true">
              {state?.status === "failed" ? "" : "Reading the shelves…"}
            </p>
          ) : (
            <div className="memory-body">
              <MemoryReaders
                catalog={catalog}
                names={host.names}
                reader={reader}
                onSelect={(next) => {
                  setReader(next);
                  setSearch(null);
                  setPane("shelves");
                }}
              />
              <div className="memory-middle">
                <div className="library-wings" role="tablist">
                  {(["memory", "artefacts"] as const).map((id) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={wing === id}
                      onClick={() => {
                        setWing(id);
                        setSearch(null);
                        setMadeFound(null);
                      }}
                    >
                      {id === "memory" ? "Memory" : "Made by agents"}
                      {id === "artefacts" && shelf ? (
                        <span>{shelved.length}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
                {madeFound !== null && madeMatches.length ? (
                  <section className="memory-wing" aria-label="Made matches">
                    <h4>
                      Made by agents <span>{madeMatches.length} found</span>
                    </h4>
                    <ArtefactShelfList
                      artefacts={madeMatches}
                      names={host.names}
                      project={project}
                      selected={made?.id ?? null}
                      onOpen={openMade}
                      empty=""
                    />
                  </section>
                ) : null}
                {search ? (
                  <MemorySearchResults
                    search={search}
                    catalog={catalog}
                    onOpen={openEntry}
                    onClear={() => {
                      setSearch(null);
                      setMadeFound(null);
                    }}
                  />
                ) : madeFound !== null ? null : wing === "artefacts" ? (
                  <ArtefactShelfList
                    artefacts={shelved}
                    names={host.names}
                    project={project}
                    selected={made?.id ?? null}
                    onOpen={openMade}
                    empty={
                      shelf
                        ? "Nothing made here yet. Reports, pages, images and links agents make show up here."
                        : "Reading what agents made…"
                    }
                  />
                ) : (
                  <MemoryShelves
                    catalog={catalog}
                    names={host.names}
                    reader={reader}
                    selected={
                      live?.kind === "entry" ? entryKey(live.entry) : null
                    }
                    onOpen={(source, entry) => openEntry(source, entry)}
                    onAdd={(source, path) => {
                      setMade(null);
                      setBook({ kind: "new", source, path });
                      setPane("book");
                    }}
                  />
                )}
              </div>
              <div className="memory-right">
                {made ? (
                  <ArtefactReader
                    target={host}
                    artefact={made}
                    names={host.names}
                    project={project}
                    route={route}
                    onBack={() => {
                      setPane("shelves");
                      setMade(null);
                    }}
                  />
                ) : live ? (
                  <MemoryBook
                    target={host}
                    open={live}
                    catalog={catalog}
                    names={host.names}
                    onBack={() => {
                      setPane("shelves");
                      if (live.kind === "new") setBook(null);
                    }}
                    onChanged={refresh}
                    onDeleted={() => {
                      setBook(null);
                      setPane("shelves");
                    }}
                    onCreated={(path) => {
                      const source = live.source;
                      // Show the new file once the catalog has it.
                      void requestMemoryCatalog(host, { force: true }).then(
                        () => {
                          const next = memoryCatalogState(host)?.catalog;
                          const entry = next?.entries.find(
                            (e) => e.source_id === source.id && e.path === path,
                          );
                          const fresh = next?.sources.find(
                            (s) => s.id === source.id,
                          );
                          if (entry && fresh)
                            setBook({ kind: "entry", source: fresh, entry });
                          else setBook(null);
                        },
                      );
                    }}
                  />
                ) : (
                  <p className="memory-empty-state memory-pick">
                    Pick a book to read it. Edits save only when you press Save.
                  </p>
                )}
              </div>
            </div>
          )}
          {catalog ? (
            <footer className="memory-foot">
              <span>
                Read {formatAge(Date.now() - catalog.observed_at)} from{" "}
                {host.label}. Files are what agents would load next, not what
                they hold now.
              </span>
              {catalog.truncated ? (
                <span className="memory-stale">
                  Only the first {catalog.limits.entries} files are shown.
                </span>
              ) : null}
              {catalog.warnings.length ? (
                <details>
                  <summary>What World can't tell</summary>
                  <ul>
                    {catalog.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </footer>
          ) : null}
        </>
      )}
    </PlaceWindow>
  );
}
