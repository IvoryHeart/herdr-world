/**
 * World's "Group runtimes" setting (#1307): how Town draws a machine's
 * runtimes, as one building or one per runtime. Hosts are machines in every
 * view whatever it says (shared/hostGrouping.ts). The control shows World's published value
 * (the replica) and changes it through a World command, so every browser
 * follows the same publication (runtimeGrouping.ts). It replaced Town's own
 * "Town buildings" choice, so its words still find it under that name.
 */

import { Building2 } from "lucide-react";
import { defineSettings } from "../settings/registry";
import type { RuntimeGrouping } from "../../../shared/hostGrouping";
import { runtimeGroupingControl } from "./runtimeGrouping";

defineSettings("runtime-grouping", [
  {
    kind: "setting",
    id: "world.runtime-grouping",
    category: "system",
    title: "Group runtimes",
    description:
      "Draw a machine's Herdr TUI and herdr-core as one Town building, or one building per runtime. Hosts stay machines everywhere",
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
    subscribe: runtimeGroupingControl.subscribe,
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
      // World's published grouping.
      get: () => runtimeGroupingControl.get(),
      set: (_host, value) => {
        // The control keeps showing the published value until World
        // publishes the change; a failure is reported.
        runtimeGroupingControl.set(value as RuntimeGrouping);
      },
    },
  },
]);
