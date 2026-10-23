import { Copy, Dices, Play, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACCESSORIES,
  HAIRS,
  HAIR_STYLES,
  HARNESS_CHOICES,
  OUTFITS,
  PANTS,
  SHIRTS,
  SKINS,
  STARTER_PROFILES,
  TOOL_CHOICES,
  agentNameFor,
  launchCommandPreview,
  launchPlan,
  type AgentLook,
  type AgentProfile,
} from "../../../shared/agentProfile";
import { ColorSwatches } from "../components/ColorSwatch";
import { CloseButton } from "../components/CloseButton";
import { useLayer } from "../layerStack";
import {
  deleteProfile,
  harnessLabel,
  launcherCatalog,
  readinessNote,
  saveProfile,
  useAgentProfiles,
  type LauncherCatalog,
} from "./agentProfiles";
import { ProfileSprite } from "./ProfileSprite";
import { TERMINAL_COLOR_PALETTE } from "./terminalColor";
import type { WorldObject } from "./worldObject";
import "./agentProfiles.css";

type Tab = "who" | "brain" | "skills" | "brief" | "look";
const TABS: [Tab, string][] = [
  ["who", "Who"],
  ["brain", "Brain"],
  ["skills", "Skills & tools"],
  ["brief", "Brief"],
  ["look", "Look"],
];
const LABELS: Record<string, string> = {
  short: "Short",
  long: "Long",
  bun: "Bun",
  cap: "Cap",
  shaved: "Shaved",
  shirt: "Shirt",
  hoodie: "Hoodie",
  coat: "Lab coat",
  dress: "Dress",
  captain: "Captain",
  none: "None",
  glasses: "Glasses",
  headset: "Headset",
  scarf: "Scarf",
  badge: "Badge",
  pencil: "Pencil",
};
const pick = <T,>(values: readonly T[]) =>
  values[Math.floor(Math.random() * values.length)]!;

function uniqueId(name: string, taken: ReadonlySet<string>) {
  return agentNameFor(name, taken);
}

/**
 * The profile editor and Town's character creator: who an agent is, its
 * brain (harness and model), skills and tools, starting brief and look, with
 * a live preview and what a launch will run. Opened from World settings,
 * Town and Board.
 */
export function ProfileEditor({
  world,
  initialId,
  onLaunch,
  onClose,
}: {
  world: WorldObject;
  initialId?: string;
  /** Open the launcher with this profile chosen. */
  onLaunch(profileId: string): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(true, () => onClose(), { element: () => ref.current });
  const { document, error: loadError } = useAgentProfiles();
  const profiles = document?.profiles ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(
    initialId ?? null,
  );
  const [draft, setDraft] = useState<AgentProfile | null>(null);
  const [tab, setTab] = useState<Tab>("who");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showWorld, setShowWorld] = useState(false);

  // The first room's host answers which kinds and skills exist.
  const host = world.spaces.find((space) => space.actionable && !space.stale);
  const [catalog, setCatalog] = useState<LauncherCatalog | null>(null);
  const hostConnection = host?.connectionId;
  const hostGeneration = host?.generation;
  const hostWorkspace = host?.nativeId;
  useEffect(() => {
    if (!hostConnection || hostGeneration === undefined || !hostWorkspace)
      return;
    let current = true;
    launcherCatalog({
      connectionId: hostConnection,
      generation: hostGeneration,
      workspaceId: hostWorkspace,
    })
      .then((next) => current && setCatalog(next))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [hostConnection, hostGeneration, hostWorkspace]);

  const saved = profiles.find((p) => p.id === selectedId) ?? null;
  const firstId = profiles[0]?.id;
  useEffect(() => {
    if (!selectedId && firstId) setSelectedId(firstId);
  }, [firstId, selectedId]);
  useEffect(() => {
    // A new selection (or its first load) starts a fresh draft.
    if (saved && draft?.id !== saved.id) setDraft(structuredClone(saved));
  }, [saved, draft?.id]);

  const dirty = useMemo(
    () => Boolean(draft) && JSON.stringify(draft) !== JSON.stringify(saved),
    [draft, saved],
  );
  const rooms = useMemo(
    () => [...new Set(world.spaces.map((space) => space.label))].sort(),
    [world.spaces],
  );

  const update = (patch: Partial<AgentProfile>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));
  const updateLook = (patch: Partial<AgentLook>) =>
    setDraft((current) =>
      current ? { ...current, look: { ...current.look, ...patch } } : current,
    );

  const persist = async (profile: AgentProfile) => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await saveProfile(profile);
      setSelectedId(profile.id);
      setDraft(structuredClone(profile));
      setMessage("Saved.");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const create = (from: AgentProfile, name: string) => {
    const ids = new Set(profiles.map((p) => p.id));
    const profile = structuredClone(from);
    delete profile.starter;
    profile.name = name;
    profile.id = uniqueId(name, ids);
    void persist(profile);
  };

  const toggle = (list: string[], item: string) =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  const kinds = useMemo(() => {
    const listed = catalog?.kinds ?? ["claude", "codex"];
    return draft && !listed.includes(draft.harness)
      ? [draft.harness, ...listed]
      : listed;
  }, [catalog, draft]);
  const choices = draft ? HARNESS_CHOICES[draft.harness] : undefined;
  const skills = useMemo(
    () => [...new Set([...(catalog?.skills ?? []), ...(draft?.skills ?? [])])],
    [catalog, draft?.skills],
  );

  return (
    <div className="modal-backdrop">
      <div
        ref={ref}
        className="modal profile-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Agent profiles"
      >
        <div className="modal-head">
          <h2>Agent profiles</h2>
          <CloseButton onClick={onClose} label="Close agent profiles" />
        </div>
        {loadError && !document ? (
          <p className="agent-launcher-error">{loadError}</p>
        ) : null}
        <div className="profile-editor-grid">
          <aside className="profile-roster" aria-label="Profiles">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                className="profile-roster-item"
                aria-pressed={profile.id === selectedId}
                onClick={() => {
                  setSelectedId(profile.id);
                  setDraft(structuredClone(profile));
                  setMessage(null);
                  setError(null);
                }}
              >
                <ProfileSprite look={profile.look} scale={2} />
                <span>
                  <b>
                    {profile.name}
                    {profile.starter ? <i> starter</i> : null}
                  </b>
                  <small>{harnessLabel(profile.harness)}</small>
                </span>
              </button>
            ))}
            <button
              type="button"
              className="profile-roster-new"
              onClick={() => create(STARTER_PROFILES[1]!, "New agent")}
            >
              <Plus size={14} aria-hidden="true" /> New profile
            </button>
          </aside>
          {draft ? (
            <section className="profile-form" aria-label="Profile">
              <div className="profile-form-head">
                <b>{draft.name || "Unnamed"}</b>
                <button
                  type="button"
                  onClick={() => create(draft, `${draft.name} copy`)}
                >
                  <Copy size={13} aria-hidden="true" /> Duplicate
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!window.confirm(`Delete the profile ${draft.name}?`))
                      return;
                    try {
                      await deleteProfile(draft.id);
                      setSelectedId(null);
                      setDraft(null);
                    } catch (cause) {
                      setError(
                        cause instanceof Error ? cause.message : String(cause),
                      );
                    }
                  }}
                >
                  <Trash2 size={13} aria-hidden="true" /> Delete
                </button>
                <button
                  type="button"
                  className="profile-primary"
                  disabled={saving}
                  onClick={async () => {
                    if (!dirty || (await persist(draft))) onLaunch(draft.id);
                  }}
                >
                  <Play size={13} aria-hidden="true" /> New agent
                </button>
              </div>
              <div className="profile-tabs" role="tablist">
                {TABS.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={tab === id}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {tab === "who" ? (
                <div className="profile-pane">
                  <label className="agent-field">
                    <span>Name</span>
                    <input
                      value={draft.name}
                      maxLength={32}
                      onChange={(event) => update({ name: event.target.value })}
                    />
                    <small>
                      Herdr knows it as <code>{agentNameFor(draft.name)}</code>;
                      a number is added if that name is taken.
                    </small>
                  </label>
                  <label className="agent-field">
                    <span>Home room</span>
                    <select
                      value={draft.home_room}
                      onChange={(event) =>
                        update({ home_room: event.target.value })
                      }
                    >
                      <option value="">Any room</option>
                      {[...new Set([draft.home_room, ...rooms])]
                        .filter(Boolean)
                        .map((label) => (
                          <option key={label} value={label}>
                            {label}
                          </option>
                        ))}
                    </select>
                    <small>New agents start here unless you pick a room.</small>
                  </label>
                  <label className="agent-field">
                    <span>Role or persona</span>
                    <textarea
                      rows={5}
                      value={draft.role}
                      onChange={(event) => update({ role: event.target.value })}
                    />
                    <small>
                      How it works, not today's task; that is the brief.
                    </small>
                  </label>
                  <div className="agent-field">
                    <span>Colour</span>
                    <ColorSwatches
                      palette={TERMINAL_COLOR_PALETTE}
                      current={{
                        id: draft.color ?? "",
                        custom: draft.color !== null,
                      }}
                      onColor={(id) =>
                        update({ color: id as AgentProfile["color"] })
                      }
                      label="Profile colour"
                    />
                    <small>Its tab, desk and card colour.</small>
                  </div>
                </div>
              ) : null}
              {tab === "brain" ? (
                <div className="profile-pane">
                  <p className="agent-launcher-note">
                    Harnesses are the ones this host's Herdr supports.
                    Credentials stay with each harness; a profile never stores
                    one.
                  </p>
                  {(() => {
                    const option = (kind: string) => {
                      const note = readinessNote(kind, catalog);
                      return (
                        <label key={kind}>
                          <input
                            type="radio"
                            name="profile-harness"
                            checked={draft.harness === kind}
                            onChange={() =>
                              update({
                                harness: kind,
                                model: "",
                                effort: "",
                                permission: "",
                              })
                            }
                          />
                          <span>
                            <b>{harnessLabel(kind)}</b>
                            {note ? <small>{note.text}</small> : null}
                          </span>
                        </label>
                      );
                    };
                    // Harnesses this host lacks fold away, unless chosen.
                    const missing = (kind: string) =>
                      kind !== draft.harness &&
                      Boolean(readinessNote(kind, catalog)?.blocked);
                    const absent = kinds.filter(missing);
                    return (
                      <div className="profile-radio" role="radiogroup">
                        {kinds.filter((kind) => !missing(kind)).map(option)}
                        {absent.length ? (
                          <details>
                            <summary>
                              {absent.length} more that Herdr supports but this
                              host does not have
                            </summary>
                            {absent.map(option)}
                          </details>
                        ) : null}
                      </div>
                    );
                  })()}
                  <label className="agent-field">
                    <span>Model</span>
                    <input
                      list="profile-models"
                      value={draft.model}
                      placeholder="The harness's default"
                      onChange={(event) =>
                        update({ model: event.target.value.trim() })
                      }
                    />
                    <datalist id="profile-models">
                      {(choices?.models ?? []).map((model) => (
                        <option key={model} value={model} />
                      ))}
                    </datalist>
                  </label>
                  {choices?.efforts.length ? (
                    <label className="agent-field">
                      <span>Reasoning effort</span>
                      <select
                        value={draft.effort}
                        onChange={(event) =>
                          update({ effort: event.target.value })
                        }
                      >
                        <option value="">The harness's default</option>
                        {choices.efforts.map((effort) => (
                          <option key={effort}>{effort}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {choices ? (
                    <div className="agent-field">
                      <span>Permission mode</span>
                      <div className="profile-radio" role="radiogroup">
                        {[["", "The harness's default"] as [string, string]]
                          .concat(choices.permissions)
                          .map(([mode, help]) => (
                            <label key={mode || "default"}>
                              <input
                                type="radio"
                                name="profile-permission"
                                checked={draft.permission === mode}
                                onChange={() => update({ permission: mode })}
                              />
                              <span>
                                <b>{mode || "default"}</b>
                                <small>{help}</small>
                              </span>
                            </label>
                          ))}
                      </div>
                    </div>
                  ) : (
                    <p className="agent-launcher-note">
                      World has no option mapping for this harness yet: it
                      starts with its own settings and gets the role in its
                      first prompt.
                    </p>
                  )}
                </div>
              ) : null}
              {tab === "skills" ? (
                <div className="profile-pane">
                  <div className="agent-field">
                    <span>Skills</span>
                    <small>
                      Skill folders (<code>SKILL.md</code>) found in the room's
                      repository and the host's harness folders.
                    </small>
                    <div className="profile-chips">
                      {skills.length ? (
                        skills.map((skill) => (
                          <button
                            key={skill}
                            type="button"
                            aria-pressed={draft.skills.includes(skill)}
                            onClick={() =>
                              update({ skills: toggle(draft.skills, skill) })
                            }
                          >
                            {skill}
                          </button>
                        ))
                      ) : (
                        <small>No skill folders found on this host.</small>
                      )}
                    </div>
                  </div>
                  <div className="agent-field">
                    <span>Tools</span>
                    <small>
                      None chosen means the harness's own set. Claude Code
                      allows only these; Codex reads Edit or Write as write
                      access to the workspace, otherwise read-only.
                    </small>
                    <div className="profile-chips">
                      {[...new Set([...TOOL_CHOICES, ...draft.tools])].map(
                        (tool) => (
                          <button
                            key={tool}
                            type="button"
                            aria-pressed={draft.tools.includes(tool)}
                            onClick={() =>
                              update({ tools: toggle(draft.tools, tool) })
                            }
                          >
                            {tool}
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
              {tab === "brief" ? (
                <div className="profile-pane">
                  <label className="agent-field">
                    <span>Starting brief</span>
                    <textarea
                      rows={10}
                      value={draft.brief}
                      onChange={(event) =>
                        update({ brief: event.target.value })
                      }
                    />
                    <small>
                      Filled at launch: <code>{"{{name}}"}</code>{" "}
                      <code>{"{{task}}"}</code> <code>{"{{room}}"}</code>{" "}
                      <code>{"{{spawned_by}}"}</code>
                    </small>
                  </label>
                  <label className="profile-check">
                    <input
                      type="checkbox"
                      checked={draft.send_brief}
                      onChange={(event) =>
                        update({ send_brief: event.target.checked })
                      }
                    />
                    Send the brief as the first prompt once the agent is ready
                  </label>
                </div>
              ) : null}
              {tab === "look" ? (
                <div className="profile-pane">
                  <LookSwatches
                    label="Skin"
                    values={SKINS}
                    current={draft.look.skin}
                    onPick={(skin) => updateLook({ skin })}
                  />
                  <LookOptions
                    label="Hair"
                    values={HAIR_STYLES}
                    current={draft.look.hair_style}
                    onPick={(hair_style) => updateLook({ hair_style })}
                  />
                  <LookSwatches
                    label="Hair colour"
                    values={HAIRS}
                    current={draft.look.hair}
                    onPick={(hair) => updateLook({ hair })}
                  />
                  <LookOptions
                    label="Outfit"
                    values={OUTFITS}
                    current={draft.look.outfit}
                    onPick={(outfit) => updateLook({ outfit })}
                  />
                  <LookSwatches
                    label="Shirt or dress"
                    values={SHIRTS}
                    current={draft.look.shirt}
                    onPick={(shirt) => updateLook({ shirt })}
                  />
                  <LookSwatches
                    label="Trousers"
                    values={PANTS}
                    current={draft.look.pants}
                    onPick={(pants) => updateLook({ pants })}
                  />
                  <LookOptions
                    label="Accessory"
                    values={ACCESSORIES}
                    current={draft.look.accessory}
                    onPick={(accessory) => updateLook({ accessory })}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      updateLook({
                        skin: pick(SKINS),
                        hair: pick(HAIRS),
                        hair_style: pick(HAIR_STYLES),
                        outfit: pick(OUTFITS),
                        shirt: pick(SHIRTS),
                        pants: pick(PANTS),
                        accessory: pick(ACCESSORIES),
                      })
                    }
                  >
                    <Dices size={13} aria-hidden="true" /> Surprise me
                  </button>
                </div>
              ) : null}
              <div className="profile-form-foot" role="status">
                {error ? (
                  <span className="agent-launcher-error">{error}</span>
                ) : message && !dirty ? (
                  <span>{message}</span>
                ) : dirty ? (
                  <span>Unsaved changes</span>
                ) : null}
                <button
                  type="button"
                  className="profile-primary"
                  disabled={!dirty || saving}
                  onClick={() => void persist(draft)}
                >
                  <Save size={13} aria-hidden="true" /> Save
                </button>
              </div>
            </section>
          ) : null}
          {draft ? (
            <div className="profile-side">
              <section className="profile-preview" aria-label="Preview">
                <ProfileSprite
                  look={draft.look}
                  scale={6}
                  animate
                  label={`${draft.name} in Town`}
                />
                <span
                  className="profile-tag"
                  style={{
                    borderLeftColor: draft.color
                      ? TERMINAL_COLOR_PALETTE.find((c) => c.id === draft.color)
                          ?.hex
                      : undefined,
                  }}
                >
                  {agentNameFor(draft.name)}
                </span>
              </section>
              <section className="profile-launch" aria-label="What launch runs">
                <div className="agent-launcher-section-head">
                  <h3>What a launch runs</h3>
                  <button
                    type="button"
                    aria-pressed={showWorld}
                    onClick={() => setShowWorld((v) => !v)}
                  >
                    {showWorld ? "Harness" : "World profile"}
                  </button>
                </div>
                <pre>
                  {showWorld
                    ? JSON.stringify(draft, null, 2)
                    : `${launchCommandPreview(draft)}\n\n# ${launchPlan(draft, agentNameFor(draft.name)).summary}`}
                </pre>
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LookSwatches({
  label,
  values,
  current,
  onPick,
}: {
  label: string;
  values: readonly string[];
  current: string;
  onPick(value: string): void;
}) {
  return (
    <div className="agent-field">
      <span>{label}</span>
      <div className="profile-swatches" role="group" aria-label={label}>
        {values.map((value) => (
          <button
            key={value}
            type="button"
            style={{ background: value }}
            aria-label={`${label} ${value}`}
            aria-pressed={current === value}
            onClick={() => onPick(value)}
          />
        ))}
      </div>
    </div>
  );
}

function LookOptions<T extends string>({
  label,
  values,
  current,
  onPick,
}: {
  label: string;
  values: readonly T[];
  current: T;
  onPick(value: T): void;
}) {
  return (
    <div className="agent-field">
      <span>{label}</span>
      <div className="profile-chips" role="group" aria-label={label}>
        {values.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={current === value}
            onClick={() => onPick(value)}
          >
            {LABELS[value] ?? value}
          </button>
        ))}
      </div>
    </div>
  );
}
