import { useEffect, useId, useRef, useState } from "react";
import { CloseButton } from "../../components/CloseButton";
import { focusDialogElement } from "../../components/dialogFocus";
import { ConfirmDialog } from "../../components/ModalDialogs";
import type {
  IdeClient,
  IdeProviderId,
  IdeProviderStatus,
  IdeStatus,
} from "./ideClient";
import { IdeServerList, runningIdeServers } from "./IdeServers";
import "./IdeProviders.css";

const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export function ideStateLabel(provider: IdeProviderStatus) {
  if (provider.enabled) return "Enabled";
  if (provider.detection.state === "detected") return "Installed";
  if (provider.detection.state === "unsupported") return "Can't run";
  return provider.detection.configured ? "Not found" : "Not installed";
}

/** Enable is offered unless the IDE can't run at all. */
const canEnable = (provider: IdeProviderStatus) =>
  !provider.enabled && provider.detection.state !== "unsupported";

/**
 * The IDE integrations, as rows: each offers Enable (behind the trust and
 * licence gate) and, when it isn't installed on World's computer, Connect
 * (where to get it, or the program's path). Detection here is for World's
 * computer; a project on an SSH host uses the IDE installed there, looked
 * for when it opens. The Code view and Settings show the same rows.
 */
export function IdeProviderList({
  status,
  client,
  onStatus,
  only,
}: {
  status: IdeStatus;
  client: IdeClient;
  onStatus: (status: IdeStatus) => void;
  /** Show one provider only. */
  only?: IdeProviderId;
}) {
  const [gate, setGate] = useState<IdeProviderStatus | null>(null);
  const [disabling, setDisabling] = useState<IdeProviderStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, action: () => Promise<IdeStatus>) => {
    setBusy(key);
    setError(null);
    try {
      onStatus(await action());
      return true;
    } catch (cause) {
      setError(errorText(cause));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const providers = only
    ? status.providers.filter((provider) => provider.id === only)
    : status.providers;
  const serversOf = (provider: IdeProviderId) =>
    runningIdeServers(status).filter(
      (instance) => instance.provider === provider,
    ).length;
  const disable = (provider: IdeProviderStatus) =>
    void run(`disable:${provider.id}`, () => client.disable(provider.id));
  const disablingCount = disabling ? serversOf(disabling.id) : 0;
  return (
    <div className="ide-providers">
      <ul className="ide-provider-list" aria-label="IDE integrations">
        {providers.map((provider) => (
          <IdeProviderRow
            key={provider.id}
            provider={provider}
            busy={busy !== null}
            onEnable={() => setGate(provider)}
            onDisable={() =>
              // Its servers keep running: list them first, with Stop each.
              serversOf(provider.id)
                ? setDisabling(provider)
                : disable(provider)
            }
            onConfigure={(binary) =>
              run(`configure:${provider.id}`, () =>
                client.configure(provider.id, binary),
              )
            }
          />
        ))}
      </ul>
      {error ? (
        <p className="ide-providers-error" role="alert">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={disabling !== null}
        title={`Disable ${disabling?.label ?? "the IDE"}`}
        message={
          disabling
            ? `Nothing more opens with ${disabling.label}.${disablingCount ? ` ${disablingCount === 1 ? "Its IDE server keeps running and stays listed until you stop it." : `Its ${disablingCount} IDE servers keep running and stay listed until you stop them.`} Stop any you no longer need here first; disabling stops none.` : ""}`
            : ""
        }
        details={
          disabling ? (
            <IdeServerList
              status={status}
              inline
              only={(instance) => instance.provider === disabling.id}
              empty="None of its IDE servers runs now."
              onStop={async (instance) =>
                onStatus(await client.stop(instance.id))
              }
              onForget={async (instance) =>
                onStatus(await client.forget(instance.id))
              }
            />
          ) : null
        }
        confirmLabel="Disable"
        onClose={() => setDisabling(null)}
        onConfirm={() => {
          if (disabling) disable(disabling);
        }}
      />
      {gate ? (
        <IdeEnableDialog
          provider={gate}
          onClose={() => setGate(null)}
          onEnable={async () => {
            if (await run(`enable:${gate.id}`, () => client.enable(gate.id)))
              setGate(null);
          }}
          busy={busy !== null}
        />
      ) : null}
    </div>
  );
}

function IdeProviderRow({
  provider,
  busy,
  onEnable,
  onDisable,
  onConfigure,
}: {
  provider: IdeProviderStatus;
  busy: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onConfigure: (binary: string | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [path, setPath] = useState(provider.binary ?? "");
  const inputId = useId();
  const detection = provider.detection;
  const state = ideStateLabel(provider);
  return (
    <li
      className="ide-provider"
      data-provider={provider.id}
      data-state={provider.enabled ? "enabled" : detection.state}
    >
      <div className="ide-provider-head">
        <strong>{provider.label}</strong>
        <span className="ide-provider-badge" data-state={state}>
          {state}
          {detection.state === "detected" && detection.version
            ? ` · ${detection.version}`
            : ""}
        </span>
        <span className="ide-provider-market">
          Extensions from {provider.marketplace}
        </span>
      </div>
      {detection.state === "detected" ? (
        <code className="ide-provider-path" title="The program World runs">
          {detection.path}
        </code>
      ) : (
        <p className="ide-provider-reason">{detection.reason}</p>
      )}
      {detection.state === "missing" ? (
        <p className="ide-provider-reason">
          Projects on an SSH host use the {provider.label} installed there:
          World looks for it when you open one.
        </p>
      ) : null}
      {!provider.webviewsInWorld ? (
        <p className="ide-provider-reason">
          Its webviews, such as Markdown preview and some extension panels, load
          from another site, so they stay blank inside World. Editing,
          terminals, Git and debugging work.
        </p>
      ) : null}
      {provider.needsSecurePage ? (
        <p className="ide-provider-reason">
          It opens only when World is on HTTPS, or at localhost on the computer
          World runs on.
        </p>
      ) : null}
      <div className="ide-provider-actions">
        {canEnable(provider) ? (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={onEnable}
          >
            Enable…
          </button>
        ) : null}
        {provider.enabled ? (
          <button type="button" disabled={busy} onClick={onDisable}>
            Disable
          </button>
        ) : null}
        {detection.state !== "detected" && provider.setupUrl ? (
          <a
            className="ide-provider-connect"
            href={provider.setupUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Connect: get {provider.label}
          </a>
        ) : null}
        {!editing ? (
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => {
              setPath(provider.binary ?? "");
              setEditing(true);
            }}
          >
            {provider.binary ? "Change program path" : "Use a program path…"}
          </button>
        ) : null}
        {provider.binary && !editing ? (
          <button
            type="button"
            className="ghost"
            disabled={busy}
            onClick={() => void onConfigure(null)}
          >
            Find it automatically
          </button>
        ) : null}
      </div>
      {editing ? (
        <form
          className="ide-provider-path-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onConfigure(path.trim() || null).then((ok) => {
              if (ok) setEditing(false);
            });
          }}
        >
          <label htmlFor={inputId}>
            {provider.id === "vscode"
              ? "Path to VS Code's code-tunnel program, or the standalone code CLI"
              : `Path to the ${provider.label} program`}
          </label>
          <input
            id={inputId}
            value={path}
            spellCheck={false}
            autoComplete="off"
            placeholder="/usr/local/bin/…"
            onChange={(event) => setPath(event.target.value)}
          />
          <div className="ide-provider-actions">
            <button type="submit" disabled={busy}>
              Save
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

/**
 * The gate before first enable (design #988): what World will run, the
 * authority it gets, where its content comes from, and the upstream terms.
 * Enable stays off until each box is ticked.
 */
export function IdeEnableDialog({
  provider,
  busy,
  onEnable,
  onClose,
}: {
  provider: IdeProviderStatus;
  busy: boolean;
  onEnable: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const [trust, setTrust] = useState(false);
  const [terms, setTerms] = useState(provider.terms.length === 0);
  const titleId = useId();
  useEffect(() => {
    const cancel = focusDialogElement(dialog.current);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => {
      cancel();
      window.removeEventListener("keydown", onKey, { capture: true });
    };
  }, [onClose]);
  const detection = provider.detection;
  const microsoft = provider.id === "vscode";
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialog}
        className="modal compact-modal ide-gate"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id={titleId}>Enable {provider.label} in World</h2>
          <CloseButton onClick={onClose} />
        </div>
        <div className="ide-gate-body">
          <p>
            World runs your installed {provider.label}
            {detection.state === "detected" && detection.version
              ? ` ${detection.version}`
              : ""}{" "}
            as a web server on the computer each project is on, this one or the
            project's SSH host, one per project you open, and shows it in Code.
            Your own settings, extensions and profile there apply. World never
            installs or updates it.
          </p>
          <ul>
            <li>
              <strong>Full access to those computers.</strong> {provider.label}{" "}
              and its extensions run as your user: they can run any command and
              change any file, not only the project's.
            </li>
            <li>
              <strong>Full access to World.</strong> It runs inside World's own
              page and address, so its extensions can do anything World's page
              can, including acting for you in World.
            </li>
            {microsoft ? (
              <li>
                <strong>Content from Microsoft.</strong> Some features load from
                Microsoft's servers: webviews (vscode-cdn.net), the Marketplace,
                Settings Sync and sign-in.
              </li>
            ) : (
              <li>
                <strong>Extensions from Open VSX.</strong> Some Microsoft
                extensions aren't available there.
              </li>
            )}
            {!window.isSecureContext ? (
              <li>
                <strong>This address isn't secure.</strong>{" "}
                {provider.needsSecurePage
                  ? `${provider.label} won't open from it. Open World over HTTPS or at localhost on the computer World runs on.`
                  : "Open World over HTTPS or on this computer's own address (localhost) for webviews, previews and the clipboard to work."}
              </li>
            ) : null}
          </ul>
          <label className="ide-gate-check">
            <input
              type="checkbox"
              checked={trust}
              onChange={(event) => setTrust(event.target.checked)}
            />
            <span>
              I trust {provider.label} and its extensions with full access to
              the computers my projects are on and to World.
            </span>
          </label>
          {provider.terms.length ? (
            <label className="ide-gate-check">
              <input
                type="checkbox"
                checked={terms}
                onChange={(event) => setTerms(event.target.checked)}
              />
              <span>
                I accept the{" "}
                {provider.terms.map((term, index) => (
                  <span key={term.url}>
                    {index > 0
                      ? index === provider.terms.length - 1
                        ? " and the "
                        : ", the "
                      : ""}
                    <a
                      href={term.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {term.label}
                    </a>
                  </span>
                ))}
                .
              </span>
            </label>
          ) : null}
        </div>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!trust || !terms || busy}
            onClick={onEnable}
          >
            Enable
          </button>
        </div>
      </div>
    </div>
  );
}
