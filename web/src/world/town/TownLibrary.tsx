import { memo, useEffect } from "react";
import {
  memoryCatalogState,
  memoryHosts,
  memoryTargetKey,
  requestMemoryCatalog,
  useMemoryStore,
} from "../memory/memoryClient";
import { openMemoryLibrary } from "../memory/memoryEvents";
import {
  artefactShelfState,
  requestArtefactShelf,
  useArtefactShelves,
} from "../memory/artefactShelfClient";
import { useTownPlace } from "./useTownPlace";
import { memorySummary } from "../memory/memoryModel";
import { TOWN_TILE as T, type TownLayout } from "./townLayout";
import { townLibraryLot } from "./townLibraryLot";
import "./townLibrary.css";

/** Hosts the sign counts at most, so a big fleet never fans out reads. */
const SIGN_HOSTS = 4;

export type TownLibraryCounts =
  | { status: "none" }
  | { status: "loading" }
  | { status: "failed" }
  | {
      status: "ready";
      files: number;
      stale: number;
      shared: number;
      /** What agents made, on the "Made by agents" shelves (#1327). */
      made?: number;
    };

/** The sign's counts over the hosts' cached catalogs. */
export function townLibraryCounts(): TownLibraryCounts {
  const hosts = memoryHosts().slice(0, SIGN_HOSTS);
  if (!hosts.length) return { status: "none" };
  let files = 0;
  let stale = 0;
  let shared = 0;
  let made = 0;
  let ready = 0;
  let loading = false;
  for (const host of hosts) {
    made += artefactShelfState(host)?.shelf?.artefacts.length ?? 0;
    const state = memoryCatalogState(host);
    if (state?.catalog) {
      const summary = memorySummary(state.catalog);
      files += summary.files;
      stale += summary.stale;
      shared += summary.shared;
      ready += 1;
    } else if (!state || state.status === "loading") loading = true;
  }
  if (ready) return { status: "ready", files, stale, shared, made };
  return loading ? { status: "loading" } : { status: "failed" };
}

export function townLibrarySignText(counts: TownLibraryCounts) {
  if (counts.status === "none") return "no host";
  if (counts.status === "loading") return "…";
  if (counts.status === "failed") return "unavailable";
  const parts = [`${counts.files} file${counts.files === 1 ? "" : "s"}`];
  if (counts.stale) parts.push(`${counts.stale} stale`);
  if (counts.shared) parts.push(`${counts.shared} shared`);
  if (counts.made) parts.push(`${counts.made} made`);
  return parts.join(" · ");
}

/**
 * Town's library (#1027): what agents and projects remember, as a hall of
 * books right of the town center. Its sign counts the files, stale ones and
 * shelves several agents share, from catalogs read at most every few
 * minutes, and what agents made (#1327); it opens the Library. A narrow
 * (phone) town stands it beside the center as a wide one does (#1351).
 */
const openLibrary = () => openMemoryLibrary();

export const TownLibrary = memo(function TownLibrary({
  layout,
}: {
  layout: TownLayout;
}) {
  useMemoryStore();
  useArtefactShelves();
  const hosts = memoryHosts().slice(0, SIGN_HOSTS);
  const hostKeys = hosts.map(memoryTargetKey).join("\n");
  useEffect(() => {
    for (const host of memoryHosts().slice(0, SIGN_HOSTS)) {
      void requestMemoryCatalog(host);
      void requestArtefactShelf(host);
    }
  }, [hostKeys]);
  const counts = townLibraryCounts();
  // The building opens what its sign does (#1170), while a host serves it.
  useTownPlace("library", counts.status === "none" ? null : openLibrary);
  if (counts.status === "none") return null;
  const text = townLibrarySignText(counts);
  const label = `Library: ${text === "…" ? "reading" : text}. Open`;
  const lot = townLibraryLot(layout);
  return (
    <button
      type="button"
      className="town-library-sign"
      data-town-place="library"
      data-quiet={counts.status !== "ready" || undefined}
      style={{ left: (lot.x + lot.w / 2) * T, top: lot.y * T + 30 }}
      aria-label={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        openMemoryLibrary();
      }}
    >
      <span className="town-library-sign-title" aria-hidden="true">
        LIBRARY
      </span>
      <span className="town-library-sign-counts" aria-hidden="true">
        {text}
      </span>
    </button>
  );
});
