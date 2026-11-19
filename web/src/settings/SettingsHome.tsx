/**
 * Settings: one place for every setting and command (#1035 prototype).
 *
 * A search field, then a row of tabs (All and each category, with counts)
 * in the family of the Integrations screen (#1008); typing searches
 * everything and shows All. Each row changes its setting in place, opens
 * where a group of settings lives today, or runs its command. A link to a
 * row (`?setting=<id>`) opens Settings there.
 */

import {
  ChevronRight,
  Link2,
  Minus,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { CloseButton } from "../components/CloseButton";
import { MobileSheetHandle } from "../components/MobileSheetHandle";
import { DEVTOOLS } from "../world/devtools/flag";
import "./catalog";
import { settingsLink } from "./flag";
import {
  type ChoiceOption,
  entryShown,
  type RegistryEntry,
  registryEntries,
  registryEntry,
  SCOPE_LABELS,
  SETTINGS_CATEGORIES,
  type SettingEntry,
  type SettingsCategory,
  type SettingsHost,
  subscribeRegistry,
} from "./registry";
import { searchSettings } from "./search";
import "../components/ConfigMenu.css";
import "../components/ConfigurationDialog.css";
import "./SettingsHome.css";

type Tab = "all" | SettingsCategory;

const noSubscription = () => () => {};

/** The entry's value, re-read when it or the host changes. */
function useEntryValue<T>(entry: RegistryEntry, read: () => T): T {
  return useSyncExternalStore(entry.subscribe ?? noSubscription, read, read);
}

/** The categories a link may name, so `?setting=town` opens its tab. */
function linkTarget(target: string | null | undefined): {
  tab: Tab;
  entry: string | null;
} {
  if (!target) return { tab: "all", entry: null };
  const category = SETTINGS_CATEGORIES.find((item) => item.id === target);
  if (category) return { tab: category.id, entry: null };
  const entry = registryEntry(target);
  if (entry) return { tab: entry.category, entry: entry.id };
  return { tab: "all", entry: null };
}

export function SettingsHome({
  host,
  initial,
  onClose,
}: {
  host: SettingsHost;
  /** An entry id or category id from a link or the command box. */
  initial?: string | null;
  onClose: () => void;
}) {
  const entries = useSyncExternalStore(
    subscribeRegistry,
    registryEntries,
    registryEntries,
  );
  const start = useMemo(() => linkTarget(initial), [initial]);
  const [tab, setTab] = useState<Tab>(start.tab);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState<string | null>(start.entry);
  const [copied, setCopied] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const shown = useMemo(
    () => entries.filter((entry) => entryShown(entry, host, DEVTOOLS)),
    [entries, host],
  );
  const matches = useMemo(() => searchSettings(shown, query), [shown, query]);
  const searching = query.trim().length > 0;
  const counts = useMemo(() => {
    const result = new Map<Tab, number>([["all", matches.length]]);
    for (const { entry } of matches)
      result.set(entry.category, (result.get(entry.category) ?? 0) + 1);
    return result;
  }, [matches]);
  const visible =
    tab === "all"
      ? matches
      : matches.filter((match) => match.entry.category === tab);

  // A link names one row: show it, put it in view and mark it once.
  useLayoutEffect(() => {
    if (!start.entry) {
      if (!host.mobile) search.current?.focus({ preventScroll: true });
      else dialog.current?.focus({ preventScroll: true });
      return;
    }
    const row = list.current?.querySelector<HTMLElement>(
      `[data-setting="${CSS.escape(start.entry)}"]`,
    );
    row?.scrollIntoView({ block: "center" });
    row
      ?.querySelector<HTMLElement>("button, input, select")
      ?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => setHighlight(null), 2400);
    return () => window.clearTimeout(timer);
  }, [start.entry, host.mobile]);

  // The chosen tab stays in sight on a narrow screen.
  const tabList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabList.current
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [tab]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector(".popover-content"))
        return;
      event.preventDefault();
      event.stopPropagation();
      if (query) setQuery("");
      else onClose();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose, query]);

  const copyLink = (id: string) => {
    const link = settingsLink(id);
    void navigator.clipboard?.writeText(link).then(
      () => setCopied(id),
      () => setCopied(null),
    );
    window.setTimeout(
      () => setCopied((value) => (value === id ? null : value)),
      1800,
    );
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "all", label: "All" },
    ...SETTINGS_CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label,
    })),
  ];
  const current = SETTINGS_CATEGORIES.find((category) => category.id === tab);

  return createPortal(
    <div
      className="modal-backdrop configuration-backdrop settings-home-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        className="modal configuration-modal mobile-sheet settings-home"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <MobileSheetHandle label="Dismiss Settings" onClose={onClose} />
        <div className="modal-head">
          <div>
            <h2>Settings</h2>
            <p>Every setting and command, in one place</p>
          </div>
          <CloseButton label="Close Settings" onClick={onClose} />
        </div>
        <label className="settings-home-search">
          <Search size={15} aria-hidden="true" />
          <input
            ref={search}
            type="search"
            value={query}
            placeholder="Search settings and commands"
            aria-label="Search settings and commands"
            onChange={(event) => {
              setQuery(event.target.value);
              if (event.target.value.trim()) setTab("all");
            }}
          />
        </label>
        <div
          ref={tabList}
          className="settings-home-tabs"
          role="tablist"
          aria-label="Settings categories"
        >
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`settings-tab-${item.id}`}
              aria-controls="settings-home-list"
              aria-selected={tab === item.id}
              data-empty={(counts.get(item.id) ?? 0) === 0 ? "" : undefined}
              onClick={() => setTab(item.id)}
            >
              {item.label}
              <span className="settings-home-tab-count">
                {counts.get(item.id) ?? 0}
              </span>
            </button>
          ))}
        </div>
        <div
          ref={list}
          id="settings-home-list"
          className="configuration-content settings-home-list"
          role="tabpanel"
          aria-labelledby={`settings-tab-${tab}`}
        >
          {current && !searching ? (
            <p className="configuration-scope">{current.detail}</p>
          ) : null}
          {visible.length === 0 ? (
            <p className="settings-home-empty">
              Nothing matches “{query.trim()}”. Try another word, such as
              “sound”, “size” or “night”.
            </p>
          ) : null}
          {tab === "all" && !searching
            ? SETTINGS_CATEGORIES.map((category) => {
                const rows = visible.filter(
                  (match) => match.entry.category === category.id,
                );
                if (!rows.length) return null;
                return (
                  <section
                    key={category.id}
                    className="settings-home-group"
                    aria-label={category.label}
                  >
                    <h3>{category.label}</h3>
                    {rows.map(({ entry }) => (
                      <SettingsRow
                        key={entry.id}
                        entry={entry}
                        host={host}
                        highlighted={highlight === entry.id}
                        copied={copied === entry.id}
                        onCopyLink={copyLink}
                        onLeave={onClose}
                      />
                    ))}
                  </section>
                );
              })
            : visible.map(({ entry, option }) => (
                <SettingsRow
                  key={entry.id}
                  entry={entry}
                  host={host}
                  matched={option}
                  showCategory={searching}
                  highlighted={highlight === entry.id}
                  copied={copied === entry.id}
                  onCopyLink={copyLink}
                  onLeave={onClose}
                />
              ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SettingsRow({
  entry,
  host,
  matched,
  showCategory,
  highlighted,
  copied,
  onCopyLink,
  onLeave,
}: {
  entry: RegistryEntry;
  host: SettingsHost;
  matched?: ChoiceOption;
  showCategory?: boolean;
  highlighted: boolean;
  copied: boolean;
  onCopyLink: (id: string) => void;
  /** Settings closes when a row opens another dialog or runs a command. */
  onLeave: () => void;
}) {
  const category = SETTINGS_CATEGORIES.find(
    (item) => item.id === entry.category,
  )!.label;
  const scope =
    entry.kind === "command"
      ? null
      : entry.scope
        ? SCOPE_LABELS[entry.scope]
        : null;
  const meta = [showCategory ? category : null, scope]
    .filter(Boolean)
    .join(" · ");
  const copy = (
    <span className="config-item-copy">
      <strong>{entry.title}</strong>
      {entry.description ? <span>{entry.description}</span> : null}
      {entry.alsoOn ? (
        <span className="settings-home-also">Also on {entry.alsoOn}</span>
      ) : null}
      {meta ? <span className="settings-home-meta">{meta}</span> : null}
    </span>
  );
  const link = (
    <button
      type="button"
      className="settings-home-link"
      aria-label={copied ? "Link copied" : `Copy a link to ${entry.title}`}
      title={copied ? "Link copied" : "Copy a link to this setting"}
      onClick={() => onCopyLink(entry.id)}
    >
      <Link2 size={13} />
      {copied ? <span>Copied</span> : null}
    </button>
  );
  const rowClass =
    "config-preference-row settings-home-row" +
    (highlighted ? " is-highlighted" : "");

  if (entry.kind === "setting") {
    const wide =
      entry.control.type === "choice" || entry.control.type === "text";
    return (
      <div
        className={rowClass}
        data-setting={entry.id}
        data-wide={wide ? "" : undefined}
      >
        <span className="config-item-icon">
          {entry.icon ?? <SlidersHorizontal size={15} />}
        </span>
        {copy}
        <div className="settings-home-control">
          <SettingControlView entry={entry} host={host} matched={matched} />
          {link}
        </div>
      </div>
    );
  }

  const open =
    entry.kind === "panel"
      ? entry.open
        ? () => entry.open?.(host)
        : null
      : () => entry.run(host);
  const shortcut = entry.kind === "command" ? entry.shortcut?.() : null;
  return (
    <div className={rowClass} data-setting={entry.id}>
      <span className="config-item-icon">
        {entry.icon ?? <SlidersHorizontal size={15} />}
      </span>
      {copy}
      <div className="settings-home-control">
        {shortcut ? <kbd className="settings-home-kbd">{shortcut}</kbd> : null}
        {open ? (
          <button
            type="button"
            className={
              "settings-home-go" +
              (entry.kind === "command" && entry.danger ? " is-danger" : "")
            }
            aria-label={
              entry.kind === "panel" ? `Open ${entry.title}` : entry.title
            }
            onClick={() => {
              onLeave();
              void open();
            }}
          >
            {entry.kind === "panel" ? "Open" : "Run"}
            <ChevronRight size={13} />
          </button>
        ) : null}
        {link}
      </div>
    </div>
  );
}

function SettingControlView({
  entry,
  host,
  matched,
}: {
  entry: SettingEntry;
  host: SettingsHost;
  matched?: ChoiceOption;
}) {
  const control = entry.control;
  const value = useEntryValue(entry, () => control.get(host));
  if (control.type === "toggle") {
    const on = value as boolean;
    return (
      <button
        type="button"
        role="switch"
        aria-label={entry.title}
        aria-checked={on}
        className={"settings-switch" + (on ? " is-on" : "")}
        onClick={() => control.set(host, !on)}
      >
        <span />
      </button>
    );
  }
  if (control.type === "choice") {
    const selected = value as string;
    if (control.options.length > 4)
      return (
        <select
          className="settings-home-select"
          aria-label={entry.title}
          value={selected}
          onChange={(event) => control.set(host, event.target.value)}
        >
          {control.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    return (
      <div
        className="settings-home-choice"
        role="group"
        aria-label={entry.title}
      >
        {control.options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected === option.value}
            className={
              (selected === option.value ? "is-active" : "") +
              (matched?.value === option.value ? " is-matched" : "")
            }
            onClick={() => control.set(host, option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }
  if (control.type === "stepper") {
    const number = value as number;
    return (
      <div
        className="config-scale-control"
        role="group"
        aria-label={entry.title}
      >
        <button
          type="button"
          aria-label={`Decrease ${entry.title.toLowerCase()}`}
          disabled={number <= control.min}
          onClick={() =>
            control.set(host, Math.max(control.min, number - control.step))
          }
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          className="config-scale-value"
          aria-label={
            control.reset
              ? `${control.reset.label}, currently ${control.format(number)}`
              : `Currently ${control.format(number)}`
          }
          disabled={!control.reset}
          onClick={() => control.reset?.run(host)}
        >
          {control.format(number)}
        </button>
        <button
          type="button"
          aria-label={`Increase ${entry.title.toLowerCase()}`}
          disabled={number >= control.max}
          onClick={() =>
            control.set(host, Math.min(control.max, number + control.step))
          }
        >
          <Plus size={14} />
        </button>
      </div>
    );
  }
  return <TextControl entry={entry} host={host} value={value as string} />;
}

function TextControl({
  entry,
  host,
  value,
}: {
  entry: SettingEntry;
  host: SettingsHost;
  value: string;
}) {
  const control = entry.control;
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (control.type !== "text") return null;
  const save = () => {
    const next = draft.trim();
    if (next !== value) control.set(host, next);
  };
  return (
    <input
      className="settings-home-text"
      type="text"
      aria-label={entry.title}
      value={draft}
      maxLength={control.maxLength}
      placeholder={control.placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === "Enter") save();
      }}
    />
  );
}
