import {
  Download,
  Focus,
  HelpCircle,
  LogOut,
  Moon,
  Search,
  Settings,
} from "lucide-react";
import { ConfigMenuItem } from "../components/ConfigMenuItem";
import { shortcutLabel } from "../shortcutPreferences";
import { useFocusClock } from "../world/FocusControls";

/**
 * The Menu (#1035): the few things people do every day. Everything else is
 * in Settings and its search.
 */
export function ShortMenu({
  zenMode,
  zenAvailable,
  mobile,
  updateLabel,
  updateDisabled,
  updateNote,
  signedIn,
  loggingOut,
  logoutError,
  onSettings,
  onFind,
  onFocus,
  onZen,
  onUpdate,
  onLogOut,
}: {
  zenMode: boolean;
  zenAvailable: boolean;
  mobile: boolean;
  updateLabel: string | null;
  updateDisabled: boolean;
  updateNote: string | null;
  signedIn: boolean;
  loggingOut: boolean;
  logoutError: string;
  onSettings: (target: string | null) => void;
  onFind: () => void;
  /** Opens the Focus dialog (#1131). */
  onFocus: () => void;
  onZen: () => void;
  onUpdate: () => void;
  onLogOut: () => void;
}) {
  const focus = useFocusClock();
  return (
    <div className="config-section config-short-menu">
      <ConfigMenuItem
        icon={<Settings size={15} />}
        label="Settings"
        description="Every setting and command, with search"
        className="config-menu-item-row"
        onClick={() => onSettings(null)}
      />
      <ConfigMenuItem
        icon={<Search size={15} />}
        label="Find or act"
        description={
          mobile
            ? "Search World, settings and commands"
            : `Search World, settings and commands · ${shortcutLabel("command.menu")}`
        }
        className="config-menu-item-row"
        onClick={onFind}
      />
      <ConfigMenuItem
        icon={<Moon size={15} />}
        label="Focus"
        description={
          focus.held
            ? `Focused · ${focus.left} · End now`
            : "Hold chimes and notifications for a while"
        }
        className="config-menu-item-row"
        onClick={onFocus}
      />
      {zenAvailable ? (
        <div className="config-preference-row">
          <span className="config-item-icon">
            <Focus size={15} />
          </span>
          <div className="config-item-copy">
            <strong>Zen mode</strong>
            <span>
              {zenMode ? "Enabled" : "Disabled"}
              {mobile ? "" : ` · ${shortcutLabel("zen.toggle")}`}
            </span>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="Zen mode"
            aria-checked={zenMode}
            className={"settings-switch" + (zenMode ? " is-on" : "")}
            onClick={onZen}
          >
            <span />
          </button>
        </div>
      ) : null}
      {updateLabel ? (
        <ConfigMenuItem
          icon={<Download size={15} />}
          className="config-update-item config-menu-item-row"
          label={updateLabel}
          description={updateDisabled ? undefined : "Install and restart"}
          primary={!updateDisabled}
          disabled={updateDisabled}
          onClick={onUpdate}
        />
      ) : null}
      {updateNote ? (
        <p className="config-update-reason" role="note">
          {updateNote}
        </p>
      ) : null}
      <ConfigMenuItem
        icon={<HelpCircle size={15} />}
        label="Help"
        description="Tutorial, features, troubleshooting and changes"
        className="config-menu-item-row"
        onClick={() => onSettings("help")}
      />
      {signedIn ? (
        <>
          <ConfigMenuItem
            icon={<LogOut size={15} />}
            label={loggingOut ? "Logging out..." : "Log out"}
            description="End this browser session only"
            className="config-menu-item-row"
            disabled={loggingOut}
            onClick={onLogOut}
          />
          {logoutError ? (
            <p className="config-logout-error" role="alert">
              {logoutError}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
