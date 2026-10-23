/**
 * Agent profiles: a name, a harness ("brain"), a role, skills, tools, a
 * starting brief and a Town look. One profile is one launchable agent. The
 * service keeps profiles; the browser edits them and shows what a launch
 * will run. A profile never holds credentials: the harness keeps its own.
 *
 * Mapping to each harness's own configuration follows its standard surface:
 * Claude Code gets an inline subagent definition (`--agents` and `--agent`,
 * the same fields as `.claude/agents/*.md`), Codex gets its CLI options and
 * `developer_instructions`. Any other kind Herdr supports starts plainly and
 * receives the role ahead of the brief in its first prompt.
 */

import { isTimbre, type Timbre } from "./chimes";
import { TERMINAL_COLOR_NAMES, type TerminalColorName } from "./terminalColor";

export const HAIR_STYLES = ["short", "long", "bun", "cap", "shaved"] as const;
export const OUTFITS = ["shirt", "hoodie", "coat", "dress", "captain"] as const;
export const ACCESSORIES = [
  "none",
  "glasses",
  "headset",
  "scarf",
  "badge",
  "pencil",
] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];
export type Outfit = (typeof OUTFITS)[number];
export type Accessory = (typeof ACCESSORIES)[number];

export type AgentLook = {
  skin: string;
  hair: string;
  hair_style: HairStyle;
  outfit: Outfit;
  shirt: string;
  pants: string;
  accessory: Accessory;
};

export type AgentProfile = {
  id: string;
  name: string;
  /** One of World's starter profiles; still the owner's to edit. */
  starter?: boolean;
  /** The Herdr agent kind, as the host reports it. */
  harness: string;
  /** Empty means the harness's default. */
  model: string;
  effort: string;
  permission: string;
  role: string;
  skills: string[];
  tools: string[];
  brief: string;
  /** Send the filled brief once the agent is ready. */
  send_brief: boolean;
  /** The room (Herdr workspace label) it usually works in. */
  home_room: string;
  color: TerminalColorName | null;
  look: AgentLook;
  /** Its own chime; null uses its class's (see shared/chimes). */
  chime: Timbre | null;
  /**
   * Offer an agent launched from it the Town master role. Only the owner's
   * tap assigns the role.
   */
  town_master: boolean;
};

export const PROFILE_LIMITS = {
  profiles: 64,
  name: 32,
  role: 4000,
  brief: 8000,
  list: 32,
  item: 64,
  short: 64,
} as const;

/** Herdr's agent-name rule. */
export const AGENT_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
export const AGENT_KIND = /^[a-z][a-z0-9_-]{0,31}$/;
const HEX = /^#[0-9a-f]{6}$/;
const ITEM = /^[A-Za-z0-9][A-Za-z0-9 ._:()*/-]{0,63}$/;

/** Choices the editor offers per harness; anything else is still accepted. */
export const HARNESS_CHOICES: Record<
  string,
  {
    label: string;
    models: string[];
    efforts: string[];
    permissions: [string, string][];
  }
> = {
  claude: {
    label: "Claude",
    models: ["opus", "sonnet", "haiku"],
    efforts: [],
    permissions: [
      ["default", "Ask before edits and commands"],
      ["acceptEdits", "Edit files freely, ask before commands"],
      ["plan", "Read and plan only"],
      ["bypassPermissions", "Never ask (trusted worktrees only)"],
    ],
  },
  codex: {
    label: "Codex",
    models: [],
    efforts: ["low", "medium", "high"],
    permissions: [
      ["on-request", "The model asks when it needs to"],
      ["never", "Never ask; the sandbox still applies"],
    ],
  },
};

export const SKINS = [
  "#f7d9bb",
  "#f2c9a0",
  "#e3ad80",
  "#c68a5c",
  "#8d5a3b",
  "#5e3b27",
];
export const HAIRS = [
  "#2b2026",
  "#5a3825",
  "#a0522d",
  "#e8c26a",
  "#c94f4f",
  "#3d4f8f",
  "#ece4da",
  "#1f3b2c",
  "#d070b0",
];
export const SHIRTS = [
  "#4f7cc9",
  "#d9644a",
  "#59a86b",
  "#9b6ad6",
  "#e0b33c",
  "#3fa7a3",
  "#d65c8e",
  "#6b7a8f",
  "#f1efe6",
  "#2e3447",
];
export const PANTS = [
  "#2e3447",
  "#4a3b2f",
  "#30404a",
  "#3b3247",
  "#6b2f3a",
  "#c8b48a",
];

/** Claude Code tool names; a profile may name others the harness knows. */
export const TOOL_CHOICES = [
  "Read",
  "Grep",
  "Glob",
  "Edit",
  "Write",
  "Bash",
  "WebFetch",
  "WebSearch",
  "Agent",
];

const BRIEF = `# Brief: {{task}}

You are \`{{name}}\`, started by {{spawned_by}} in {{room}}.
Follow the repository's AGENTS.md.

## Task
{{task}}`;

export const STARTER_PROFILES: AgentProfile[] = [
  {
    id: "reviewer",
    name: "Reviewer",
    starter: true,
    harness: "codex",
    model: "",
    effort: "high",
    permission: "on-request",
    role: "You review pull requests for correctness first, then simplicity. Report findings as P1 to P3 with a failing scenario for each. You never push to the branch you review.",
    skills: ["code-review"],
    tools: ["Read", "Grep", "Glob", "Bash"],
    brief: BRIEF,
    send_brief: true,
    home_room: "",
    color: "purple",
    chime: null,
    town_master: false,
    look: {
      skin: "#e3ad80",
      hair: "#ece4da",
      hair_style: "short",
      outfit: "coat",
      shirt: "#f1efe6",
      pants: "#30404a",
      accessory: "glasses",
    },
  },
  {
    id: "builder",
    name: "Builder",
    starter: true,
    harness: "claude",
    model: "sonnet",
    effort: "",
    permission: "acceptEdits",
    role: "You implement one change on its own branch with tests and docs, keep commits functional, and open a ready pull request. You do not merge.",
    skills: [],
    tools: [],
    brief: BRIEF,
    send_brief: true,
    home_room: "",
    color: "blue",
    chime: null,
    town_master: false,
    look: {
      skin: "#c68a5c",
      hair: "#2b2026",
      hair_style: "cap",
      outfit: "hoodie",
      shirt: "#e0b33c",
      pants: "#2e3447",
      accessory: "headset",
    },
  },
  {
    id: "designer",
    name: "Designer",
    starter: true,
    harness: "claude",
    model: "opus",
    effort: "",
    permission: "acceptEdits",
    role: "You design and prototype before anyone builds. You publish clickable prototypes with synthetic data and write down which data each element needs.",
    skills: [],
    tools: [],
    brief: BRIEF,
    send_brief: false,
    home_room: "",
    color: "pink",
    chime: null,
    town_master: false,
    look: {
      skin: "#f2c9a0",
      hair: "#d070b0",
      hair_style: "bun",
      outfit: "dress",
      shirt: "#3fa7a3",
      pants: "#3b3247",
      accessory: "pencil",
    },
  },
  {
    id: "firstmate",
    name: "FirstMate",
    starter: true,
    harness: "claude",
    model: "opus",
    effort: "",
    permission: "default",
    role: "You are the owner's delegator. You keep a ledger, brief agents, and ask the owner only what only the owner can answer. You do not write product code yourself.",
    skills: [],
    tools: [],
    brief: "# FirstMate\n\nRead your ledger and pick up where it ends.",
    send_brief: false,
    home_room: "",
    color: "yellow",
    chime: null,
    town_master: true,
    look: {
      skin: "#8d5a3b",
      hair: "#5a3825",
      hair_style: "short",
      outfit: "captain",
      shirt: "#2e3447",
      pants: "#2e3447",
      accessory: "badge",
    },
  },
];

export class ProfileError extends Error {}
function fail(message: string): never {
  throw new ProfileError(message);
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Strings that look like credentials are refused, never stored. */
const SECRET =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b|\bxox[abpr]-[A-Za-z0-9-]{10,}/;

function text(value: unknown, field: string, max: number, empty = true) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") fail(`${field} must be text`);
  const trimmed = value.trim();
  if (!empty && !trimmed) fail(`${field} is required`);
  if (trimmed.length > max) fail(`${field} is longer than ${max} characters`);
  if (SECRET.test(trimmed))
    fail(`${field} looks like it holds a credential; profiles never store one`);
  return trimmed;
}
function word(value: unknown, field: string) {
  const result = text(value, field, PROFILE_LIMITS.short);
  if (result && !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result))
    fail(`${field} has characters it cannot use`);
  return result;
}
function list(value: unknown, field: string) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > PROFILE_LIMITS.list)
    fail(`${field} must be a list of at most ${PROFILE_LIMITS.list}`);
  const items = value.map((item) => text(item, field, PROFILE_LIMITS.item));
  for (const item of items)
    if (!ITEM.test(item)) fail(`${field} has an item it cannot use`);
  return [...new Set(items)];
}
function choice<T extends string>(
  value: unknown,
  options: readonly T[],
  field: string,
): T {
  if (!options.includes(value as T)) fail(`${field} is not a known choice`);
  return value as T;
}
function hex(value: unknown, field: string) {
  if (typeof value !== "string" || !HEX.test(value.toLowerCase()))
    fail(`${field} must be a #rrggbb colour`);
  return value.toLowerCase();
}

export function parseLook(value: unknown): AgentLook {
  if (!isObject(value)) fail("look must be an object");
  return {
    skin: hex(value.skin, "skin"),
    hair: hex(value.hair, "hair"),
    hair_style: choice(value.hair_style, HAIR_STYLES, "hair style"),
    outfit: choice(value.outfit, OUTFITS, "outfit"),
    shirt: hex(value.shirt, "shirt"),
    pants: hex(value.pants, "trousers"),
    accessory: choice(value.accessory, ACCESSORIES, "accessory"),
  };
}

/** Validate a profile from the browser or the saved file. */
export function parseProfile(value: unknown): AgentProfile {
  if (!isObject(value)) fail("profile must be an object");
  const id = text(value.id, "id", PROFILE_LIMITS.short, false);
  if (!AGENT_NAME.test(id)) fail("id has characters it cannot use");
  const harness = text(value.harness, "harness", 32, false);
  if (!AGENT_KIND.test(harness)) fail("harness is not an agent kind");
  const profile: AgentProfile = {
    id,
    name: text(value.name, "name", PROFILE_LIMITS.name, false),
    harness,
    model: word(value.model, "model"),
    effort: word(value.effort, "effort"),
    permission: word(value.permission, "permission mode"),
    role: text(value.role, "role", PROFILE_LIMITS.role),
    skills: list(value.skills, "skills"),
    tools: list(value.tools, "tools"),
    brief: text(value.brief, "brief", PROFILE_LIMITS.brief),
    send_brief: value.send_brief === true,
    home_room: text(value.home_room, "home room", PROFILE_LIMITS.short),
    color:
      value.color == null
        ? null
        : choice(value.color, TERMINAL_COLOR_NAMES, "colour"),
    look: parseLook(value.look),
    chime:
      value.chime == null
        ? null
        : isTimbre(value.chime)
          ? value.chime
          : fail("chime is not one of World's sounds"),
    town_master: value.town_master === true,
  };
  if (value.starter === true) profile.starter = true;
  return profile;
}

/** Herdr's agent name for a profile name: lower-case, unique among `taken`. */
export function agentNameFor(
  name: string,
  taken: ReadonlySet<string> = new Set(),
) {
  let base = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/, "")
    .slice(0, 28);
  if (!base) base = "agent";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export type BriefValues = {
  name: string;
  task: string;
  room: string;
  spawned_by: string;
};
/** Fill `{{name}}`, `{{task}}`, `{{room}}` and `{{spawned_by}}`; leave others. */
export function fillBrief(template: string, values: BriefValues) {
  return template.replace(
    /\{\{(name|task|room|spawned_by)\}\}/g,
    (_, key: keyof BriefValues) => values[key],
  );
}

const firstSentence = (value: string) =>
  (value.split(/(?<=[.!?])\s/)[0] ?? value).slice(0, 200);

export type LaunchPlan = {
  /** Native arguments Herdr passes after the agent's executable. */
  args: string[];
  /** Text sent ahead of the brief in the first prompt, for plain kinds. */
  preamble: string;
  /** How the profile reached the harness, for the editor and the docs. */
  summary: string;
};

/** Map a profile to its harness's own configuration for one launch. */
export function launchPlan(
  profile: AgentProfile,
  agentName: string,
): LaunchPlan {
  const persona =
    profile.role || `You are ${profile.name}, an agent in Herdr World.`;
  const skills = profile.skills.length
    ? `Use these skills when they apply: ${profile.skills.join(", ")}.`
    : "";
  if (profile.harness === "claude") {
    const definition: Record<string, unknown> = {
      description: firstSentence(persona),
      prompt: persona,
    };
    if (profile.tools.length) definition.tools = profile.tools;
    if (profile.model) definition.model = profile.model;
    if (profile.skills.length) definition.skills = profile.skills;
    const args = [
      "--agents",
      JSON.stringify({ [agentName]: definition }),
      "--agent",
      agentName,
    ];
    if (profile.permission) args.push("--permission-mode", profile.permission);
    return {
      args,
      preamble: "",
      summary: "Claude Code subagent definition, passed inline",
    };
  }
  if (profile.harness === "codex") {
    const args: string[] = [];
    if (profile.model) args.push("-m", profile.model);
    if (profile.permission) args.push("-a", profile.permission);
    if (profile.tools.length)
      args.push(
        "-s",
        profile.tools.some((tool) => tool === "Edit" || tool === "Write")
          ? "workspace-write"
          : "read-only",
      );
    if (profile.effort)
      args.push(
        "-c",
        `model_reasoning_effort=${JSON.stringify(profile.effort)}`,
      );
    args.push(
      "-c",
      `developer_instructions=${JSON.stringify([persona, skills].filter(Boolean).join("\n\n"))}`,
    );
    return {
      args,
      preamble: "",
      summary: "Codex options and developer instructions",
    };
  }
  return {
    args: [],
    preamble: [persona, skills].filter(Boolean).join("\n\n"),
    summary: "No mapping for this kind: the role goes in the first prompt",
  };
}

/** A shell-style rendering of the launch, for the editor's preview. */
export function launchCommandPreview(
  profile: AgentProfile,
  agentName = agentNameFor(profile.name),
) {
  const quote = (value: string) =>
    /^[A-Za-z0-9_@%+=:,./-]+$/.test(value)
      ? value
      : `'${value.replace(/'/g, "'\\''")}'`;
  const plan = launchPlan(profile, agentName);
  return [
    `herdr agent start ${agentName} --kind ${profile.harness} --pane <new tab>`,
    ...(plan.args.length ? [`  -- ${plan.args.map(quote).join(" ")}`] : []),
  ].join(" \\\n");
}
