/**
 * World's "Group runtimes" setting (#1307): one value every view that groups
 * by where agents run follows. The control shows World's published value
 * (the replica) and changes it through a World command, so every browser
 * follows the same publication (runtimeGrouping.ts). It replaced Town's own
 * "Town buildings" choice, so its words still find it under that name.
 */

import { Building2 } from "lucide-react";
import { defineSettings } from "../settings/registry";
import type { RuntimeGrouping } from "../../../shared/hostGrouping";
import { publishedRuntimeGrouping } from "./runtimeGrouping";
import { worldRuntimeStore } from "./runtimeStore";
import { setRuntimeGroupingThroughWorld } from "./worldCommands";

defineSettings("runtime-grouping", [
  {
    kind: "setting",
    id: "world.runtime-grouping",
    category: "system",
    title: "Group runtimes",
    description:
      "Show a machine's Herdr TUI and herdr-core together, or each runtime apart, in Town, Desk and the navigator",
    words: [
      "town buildings",
      "buildings",
      "hosts",
      "host",
      "machine",
      "runtime",
      "herdr-core",
      "herdr-tui",
      "navigator",
      "desk",
      "merge",
      "separate",
    ],
    icon: <Building2 size={15} />,
    scope: "world",
    subscribe: (listener) => {
      const off = worldRuntimeStore.subscribe(listener);
      return () => void off();
    },
    control: {
      type: "choice",
      options: [
        {
          value: "machine",
          label: "One per machine",
          words: ["machine", "merged", "together"],
        },
        {
          value: "runtime",
          label: "One per runtime",
          words: ["separate", "apart", "herdr-core", "herdr-tui"],
        },
      ],
      get: () => publishedRuntimeGrouping(),
      set: (_host, value) => {
        // The control keeps showing the published value until World
        // publishes the change; a failure is reported.
        const grouping = worldRuntimeStore.get().hostGrouping?.grouping ?? null;
        void setRuntimeGroupingThroughWorld(grouping, value as RuntimeGrouping);
      },
    },
  },
]);
