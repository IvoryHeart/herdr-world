/**
 * The Library (#1027) in the one registry (#1035): Settings, its search and
 * the command box open it here. Memory has no setting of its own; its notes
 * live on each host and are managed in the Library dialog.
 */

import { Library } from "lucide-react";
import { defineSettings } from "../../settings/registry";
import { libraryHosts, subscribeMemory } from "./memoryClient";
import { openMemoryLibrary } from "./memoryEvents";

defineSettings("memory", [
  {
    kind: "panel",
    id: "memory.library",
    category: "agents",
    title: "Library (memory)",
    description:
      "See, search and edit what agents and projects remember on each host, and what agents made",
    words: [
      "memory",
      "memories",
      "CLAUDE.md",
      "AGENTS.md",
      "instructions",
      "notes",
      "remember",
      "made",
      "made by agents",
      "artefacts",
      "artifacts",
      "reports",
    ],
    icon: <Library size={15} />,
    scope: "connection",
    // Also a host whose agents have all gone, with what they made (#1342).
    available: () => libraryHosts().length > 0,
    subscribe: subscribeMemory,
    alsoOn: "Town: the Library; Board: the hub; an agent's settings: Memory",
    open: () => openMemoryLibrary(),
  },
]);
