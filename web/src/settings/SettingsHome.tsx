/**
 * Settings: one place for every setting and command (#1035).
 *
 * A search field, then a row of tabs (All and each category, with counts)
 * in the family of the Integrations screen (#1008); typing searches
 * everything and shows All. Each row changes its setting in place, opens a
 * page of settings inside Settings (Back returns to the list), opens a
 * dialog or a view's control, or runs its command. A link to a row
 * (`?setting=<id>`) opens Settings there; a link to a page opens the page.
 */

import {
  ChevronLeft,
  ChevronRight,
  Link2,
  Minus,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import {
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type LazyExoticComponent,
  Suspense,
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
import { lazyWithReload } from "../lazyWithReload";
import "./catalog";
import { settingsLink } from "./links";
import {
  type ChoiceOption,
  type PanelEntry,
  type RegistryEntry,
  registryEntries,
  registryEntry,
  SCOPE_LABELS,
  SETTINGS_CATEGORIES,
  type SettingEntry,
  type SettingsCategory,
  type SettingsHost,
  type SettingsPage,
  type SettingsPageProps,
  subscribeRegistry,
} from "./registry";
import { searchSettings } from "./search";
import { useShownEntries } from "./useShownEntries";
import "../components/ConfigMenu.css";
import "./SettingsModal.css";
import "./SettingsHome.css";

type Tab = "all" | SettingsCategory;

type PageEntry = PanelEntry & { page: SettingsPage };

const pageComponents = new Map<
  SettingsPage["load"],
  LazyExoticComponent<ComponentType<SettingsPageProps>>
>();

/** One lazy component per page, however many entries open it. */
function pageComponent(entry: PageEntry) {
  let component = pageComponents.get(entry.page.load);
  if (!component) {
    component = lazyWithReload(`settings-page:${entry.id}`, entry.page.load);
    pageComponents.set(entry.page.load, component);
  }
  return component;
}

function isPage(entry: RegistryEntry | undefined): entry is PageEntry {
  return entry?.kind === "panel" && !!entry.page;
}

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

/** Arrow keys, Home and End move between tabs, as in any tab list. */
function nextTab(key: string, index: number, count: number) {
  if (key === "ArrowRight") return (index + 1) % count;
  if (key === "ArrowLeft") return (index + count - 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** Tab and Shift+Tab stay inside the dialog. */
function keepFocusInside(event: ReactKeyboardEvent<HTMLDivElement>) {
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      "button:not(:disabled):not([tabindex='-1']), input:not(:disabled), select:not(:disabled), a[href]",
    ),
  ).filter((element) => element.getClientRects().length > 0);
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (
    event.shiftKey &&
    (document.activeElement === first ||
      document.activeElement === event.currentTarget)
  ) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

export function SettingsHome({
  host,
  initial,
  focus,
  onClose,
}: {
  host: SettingsHost;
  /** An entry id or category id from a link or the command box. */
  initial?: string | null;
  /** For a page: the row to show first, in place of the page's own. */
  focus?: string;
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
  // A page open inside Settings, and the row it was opened from.
  const [page, setPage] = useState<{ entry: PageEntry; focus?: string } | null>(
    () => {
      const entry = start.entry ? registryEntry(start.entry) : undefined;
      return isPage(entry) ? { entry, focus: focus ?? entry.page.focus } : null;
    },
  );
  const returnTo = useRef<string | null>(page?.entry.id ?? null);
  const dialog = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const shown = useShownEntries(entries, host);
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
    if (page) return;
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
    // Runs once, for the link; Back from a page puts focus back itself.
  }, [start.entry, host.mobile]);

  const openPage = (entry: PageEntry) => {
    returnTo.current = entry.id;
    setPage({ entry, focus: entry.page.focus });
  };
  const back = () => setPage(null);
  // Back puts focus on the row the page was opened from.
  useLayoutEffect(() => {
    if (page) {
      dialog.current?.focus({ preventScroll: true });
      return;
    }
    const id = returnTo.current;
    if (!id) return;
    returnTo.current = null;
    const row = list.current?.querySelector<HTMLElement>(
      `[data-setting="${CSS.escape(id)}"]`,
    );
    row?.scrollIntoView?.({ block: "nearest" });
    row?.querySelector<HTMLElement>(".settings-home-go")?.focus({
      preventScroll: true,
    });
  }, [page]);

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
      if (page) setPage(null);
      else if (query) setQuery("");
      else onClose();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose, query, page]);

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
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Tab") keepFocusInside(event);
        }}
      >
        <MobileSheetHandle label="Dismiss Settings" onClose={onClose} />
        {page ? (
          <SettingsPageView
            entry={page.entry}
            focus={page.focus}
            onBack={back}
            onClose={onClose}
          />
        ) : null}
        <div className="modal-head" hidden={!!page}>
          <div>
            <h2>Settings</h2>
            <p>Every setting and command, in one place</p>
          </div>
          <CloseButton label="Close Settings" onClick={onClose} />
        </div>
        <label className="settings-home-search" hidden={!!page}>
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
          hidden={!!page}
          className="settings-home-tabs"
          role="tablist"
          aria-label="Settings categories"
        >
          {tabs.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`settings-tab-${item.id}`}
              aria-controls="settings-home-list"
              aria-selected={tab === item.id}
              tabIndex={tab === item.id ? 0 : -1}
              data-empty={(counts.get(item.id) ?? 0) === 0 ? "" : undefined}
              onClick={() => setTab(item.id)}
              onKeyDown={(event) => {
                const next = nextTab(event.key, index, tabs.length);
                if (next === null) return;
                event.preventDefault();
                setTab(tabs[next].id);
                document
                  .getElementById(`settings-tab-${tabs[next].id}`)
                  ?.focus();
              }}
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
          hidden={!!page}
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
                        onOpenPage={openPage}
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
                  onOpenPage={openPage}
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
  onOpenPage,
  onLeave,
}: {
  entry: RegistryEntry;
  host: SettingsHost;
  matched?: ChoiceOption;
  showCategory?: boolean;
  highlighted: boolean;
  copied: boolean;
  onCopyLink: (id: string) => void;
  /** A page opens inside Settings. */
  onOpenPage: (entry: PageEntry) => void;
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
      {entry.kind === "command" && entry.disabledReason?.() ? (
        <span>{entry.disabledReason()}</span>
      ) : entry.kind === "setting" && entry.status?.() ? (
        <span className="settings-home-status">{entry.status()}</span>
      ) : entry.description ? (
        <span>{entry.description}</span>
      ) : null}
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

  const inPlace = isPage(entry) ? entry : null;
  const open =
    entry.kind === "panel"
      ? entry.open
        ? () => entry.open?.(host)
        : null
      : () => entry.run(host);
  const shortcut = entry.kind === "command" ? entry.shortcut?.() : null;
  // The command box's own admission: a command it cannot run now says why.
  const blocked =
    entry.kind === "command" ? (entry.disabledReason?.() ?? null) : null;
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
            disabled={!!blocked}
            title={blocked ?? undefined}
            onClick={() => {
              onLeave();
              void open();
            }}
          >
            {entry.kind === "panel" ? "Open" : "Run"}
            <ChevronRight size={13} />
          </button>
        ) : inPlace ? (
          <button
            type="button"
            className="settings-home-go"
            aria-label={`Open ${entry.title}`}
            onClick={() => onOpenPage(inPlace)}
          >
            Open
            <ChevronRight size={13} />
          </button>
        ) : null}
        {link}
      </div>
    </div>
  );
}

/** A page of settings inside Settings, with Back to the list. */
function SettingsPageView({
  entry,
  focus,
  onBack,
  onClose,
}: {
  entry: PageEntry;
  focus?: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const Page = pageComponent(entry);
  return (
    <>
      <div className="modal-head settings-page-head">
        <button
          type="button"
          className="settings-page-back"
          aria-label="Back to Settings"
          onClick={onBack}
        >
          <ChevronLeft size={16} />
          <span>Settings</span>
        </button>
        <div>
          <h2>{entry.title}</h2>
          {entry.description ? <p>{entry.description}</p> : null}
        </div>
        <CloseButton label="Close Settings" onClick={onClose} />
      </div>
      <div
        className="configuration-content settings-page"
        data-settings-page={entry.id}
      >
        {entry.scope ? (
          <p className="configuration-scope">
            Applies to: {SCOPE_LABELS[entry.scope]}
          </p>
        ) : null}
        <Suspense
          fallback={
            <p className="settings-home-empty" role="status">
              Loading…
            </p>
          }
        >
          <Page focus={focus} close={onClose} />
        </Suspense>
      </div>
    </>
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
    const busy = control.busy?.() ?? false;
    return (
      <button
        type="button"
        role="switch"
        aria-label={entry.title}
        aria-checked={on}
        aria-disabled={busy || undefined}
        className={"settings-switch" + (on ? " is-on" : "")}
        onClick={() => {
          if (!busy) control.set(host, !on);
        }}
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
