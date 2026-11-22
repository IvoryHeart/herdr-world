import { memo, useEffect } from "react";
import {
  memoryCatalogState,
  memoryHosts,
  memoryTargetKey,
  requestMemoryCatalog,
  useMemoryStore,
} from "../memory/memoryClient";
import { openMemoryLibrary } from "../memory/memoryEvents";
import { useTownPlace } from "./useTownPlace";
import { memorySummary } from "../memory/memoryModel";
import type { TownCenterLot } from "./townCenter";
import { TOWN_TILE as T, type TownLayout } from "./townLayout";
import { townLibraryFoldAt, townLibraryLot } from "./townLibraryLot";
import "./townLibrary.css";

/** Hosts the sign counts at most, so a big fleet never fans out reads. */
const SIGN_HOSTS = 4;

export type TownLibraryCounts =
  | { status: "none" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; files: number; stale: number; shared: number };

/** The sign's counts over the hosts' cached catalogs. */
export function townLibraryCounts(): TownLibraryCounts {
  const hosts = memoryHosts().slice(0, SIGN_HOSTS);
  if (!hosts.length) return { status: "none" };
  let files = 0;
  let stale = 0;
  let shared = 0;
  let ready = 0;
  let loading = false;
  for (const host of hosts) {
    const state = memoryCatalogState(host);
    if (state?.catalog) {
      const summary = memorySummary(state.catalog);
      files += summary.files;
      stale += summary.stale;
      shared += summary.shared;
      ready += 1;
    } else if (!state || state.status === "loading") loading = true;
  }
  if (ready) return { status: "ready", files, stale, shared };
  return loading ? { status: "loading" } : { status: "failed" };
}

export function townLibrarySignText(counts: TownLibraryCounts) {
  if (counts.status === "none") return "no host";
  if (counts.status === "loading") return "…";
  if (counts.status === "failed") return "unavailable";
  const parts = [`${counts.files} file${counts.files === 1 ? "" : "s"}`];
  if (counts.stale) parts.push(`${counts.stale} stale`);
  if (counts.shared) parts.push(`${counts.shared} shared`);
  return parts.join(" · ");
}

/**
 * Town's library (#1027): what agents and projects remember, as a hall of
 * books right of the town center. Its sign counts the files, stale ones and
 * shelves several agents share, from catalogs read at most every few
 * minutes; it opens the Library. A narrow town folds it to a book sign on
 * the center's left wing.
 */
const openLibrary = () => openMemoryLibrary();

export const TownLibrary = memo(function TownLibrary({
  layout,
}: {
  layout: TownLayout;
}) {
  useMemoryStore();
  const hosts = memoryHosts().slice(0, SIGN_HOSTS);
  const hostKeys = hosts.map(memoryTargetKey).join("\n");
  useEffect(() => {
    for (const host of memoryHosts().slice(0, SIGN_HOSTS))
      void requestMemoryCatalog(host);
  }, [hostKeys]);
  const counts = townLibraryCounts();
  // The building opens what its sign does (#1170), while a host serves it.
  useTownPlace("library", counts.status === "none" ? null : openLibrary);
  if (counts.status === "none") return null;
  const text = townLibrarySignText(counts);
  const label = `Library: ${text === "…" ? "reading" : text}. Open`;
  const lot = townLibraryLot(layout);
  if (!lot)
    return <FoldedSign center={layout.center} counts={counts} label={label} />;
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

function FoldedSign({
  center,
  counts,
  label,
}: {
  center: TownCenterLot;
  counts: TownLibraryCounts;
  label: string;
}) {
  const at = townLibraryFoldAt(center, T);
  return (
    <button
      type="button"
      className="town-library-fold"
      style={{ left: at.x, top: at.y }}
      aria-label={label}
      title="Library"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        openMemoryLibrary();
      }}
    >
      <span className="town-library-book" aria-hidden="true" />
      {counts.status === "ready" ? (
        <b aria-hidden="true">{counts.files}</b>
      ) : null}
    </button>
  );
}
