// Only icons HerdrSetupCard already loads: a new one splits its chunk.
import { Download, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { bridge } from "../api";
import {
  type CoreHostProbe,
  type CoreInstallHost,
  type CoreInstallStatus,
  coreInstallFake,
  hostKey,
  hostLabel,
  loginText,
} from "../coreInstall";
import "./CoreInstall.css";

type Step =
  | { kind: "checking" }
  | { kind: "confirm"; probe: CoreHostProbe; version: string | null }
  | { kind: "installing"; status: CoreInstallStatus }
  | { kind: "done"; status: CoreInstallStatus }
  | { kind: "failed"; error: string; retry: boolean };

const POLL_MS = 1000;

const call = (params: Record<string, unknown>) =>
  bridge.call("connections.core_install", {
    ...params,
    ...(coreInstallFake() ? { fake: coreInstallFake() } : {}),
  });

/**
 * Install (or set up an installed) herdr-core on one host: check it, show
 * what will happen and ask, then show progress until core runs and World is
 * connected. Nothing changes before the person confirms.
 */
export function CoreInstallPanel({
  host,
  connection,
  onClose,
}: {
  host: CoreInstallHost;
  /** Offered under a saved core connection: set up its session, connect it. */
  connection?: { id: string; session: string };
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "checking" });
  const chosen = connection ? { connection: connection.id } : {};
  const mounted = useRef(true);
  const where = hostLabel(host);
  const simulated = !!coreInstallFake();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const follow = async () => {
    while (mounted.current) {
      const status = (await call({
        action: "status",
        host,
      })) as CoreInstallStatus;
      if (!mounted.current) return;
      if (status.phase === "done") return setStep({ kind: "done", status });
      if (status.phase === "failed")
        return setStep({
          kind: "failed",
          error: status.error ?? "herdr-core could not be installed",
          retry: true,
        });
      setStep({ kind: "installing", status });
      await new Promise((done) => setTimeout(done, POLL_MS));
    }
  };

  const check = async () => {
    setStep({ kind: "checking" });
    try {
      const status = (await call({
        action: "status",
        host,
      })) as CoreInstallStatus;
      if (status.phase === "installing") return void (await follow());
      const result = (await call({ action: "probe", host, ...chosen })) as {
        probe: CoreHostProbe;
        version: string | null;
      };
      if (mounted.current)
        setStep({
          kind: "confirm",
          probe: result.probe,
          version: result.version,
        });
    } catch (error) {
      if (mounted.current)
        setStep({
          kind: "failed",
          error: (error as Error).message,
          retry: false,
        });
    }
  };

  const key = hostKey(host);
  useEffect(() => {
    void check();
    // Checks once per host.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const install = async (version: string | null) => {
    try {
      const status = (await call({
        action: "install",
        host,
        version,
        ...chosen,
      })) as CoreInstallStatus;
      if (!mounted.current) return;
      setStep({ kind: "installing", status });
      await follow();
    } catch (error) {
      if (mounted.current)
        setStep({
          kind: "failed",
          error: (error as Error).message,
          retry: true,
        });
    }
  };

  return (
    <div
      className="core-install"
      data-core-install={hostKey(host)}
      aria-busy={step.kind === "checking" || step.kind === "installing"}
    >
      {simulated ? <TestModeNote /> : null}
      {step.kind === "checking" ? (
        <p role="status" className="core-install-working">
          <LoaderCircle size={14} className="core-install-spinner" /> Checking{" "}
          {where} for herdr-core...
        </p>
      ) : null}
      {step.kind === "confirm" ? (
        <Confirm
          where={where}
          probe={step.probe}
          version={step.version}
          session={connection?.session ?? "default"}
          simulated={simulated}
          onConfirm={() => void install(step.version)}
          onCancel={onClose}
        />
      ) : null}
      {step.kind === "installing" || step.kind === "done" ? (
        <>
          <strong>
            {step.kind === "done"
              ? `herdr-core is running on ${where}, and World is connected to it.`
              : `Installing herdr-core on ${where}...`}
          </strong>
          <ol className="core-install-lines" role="log" aria-live="polite">
            {step.status.lines.map((line, index) => (
              // Lines only append; their order is their identity.
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only log.
              <li key={index}>{line}</li>
            ))}
          </ol>
          {step.kind === "installing" ? (
            <p className="core-install-working">
              <LoaderCircle size={14} className="core-install-spinner" /> This
              can take a few minutes. You can close this; it keeps going.
            </p>
          ) : (
            <div className="connection-profile-actions">
              <button type="button" onClick={onClose}>
                Done
              </button>
            </div>
          )}
        </>
      ) : null}
      {step.kind === "failed" ? (
        <>
          <div role="alert" className="connection-profile-error">
            {`Could not set up herdr-core on ${where}: ${step.error}`}
          </div>
          <div className="connection-profile-actions">
            <button type="button" onClick={() => void check()}>
              Try again
            </button>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * The `?coreInstall` testing switch applies to every host, real SSH hosts
 * included, so each panel says so before and during the run (#931).
 */
export function TestModeNote() {
  return (
    <p className="core-install-test" data-core-install-test>
      Test mode: nothing is installed, and this result is simulated. Reload
      World without <code>?coreInstall</code> to install for real.
    </p>
  );
}

export function Confirm({
  where,
  probe,
  version,
  session,
  simulated = false,
  onConfirm,
  onCancel,
}: {
  where: string;
  probe: CoreHostProbe;
  version: string | null;
  session: string;
  /** The testing switch is on: the button says it simulates. */
  simulated?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!probe.target)
    return (
      <>
        <p>
          herdr-core has no build for {where}. It runs on Linux and macOS
          (x86_64 and arm64); on Windows x64 use herdr-core&apos;s own
          PowerShell installer.
        </p>
        <div className="connection-profile-actions">
          <button type="button" onClick={onCancel}>
            Close
          </button>
        </div>
      </>
    );
  const installed = !!probe.core;
  return (
    <>
      <strong>
        {installed
          ? `herdr-core is installed on ${where}. Start it and connect?`
          : `Install herdr-core${version ? ` ${version}` : ""} on ${where}?`}
      </strong>
      <ul className="core-install-facts">
        {installed ? (
          <li>
            Uses <code>{probe.core}</code> as it is; World never replaces or
            updates it.
          </li>
        ) : (
          <>
            <li>
              Version: {version ?? "the newest release when it runs"}, for{" "}
              {probe.target}
            </li>
            <li>
              Goes into <code>{probe.dir}/herdr-core</code>
            </li>
            <li>
              Downloaded over HTTPS from releases.herdr.dev and checked against
              its SHA-256
            </li>
          </>
        )}
        <li>{loginText(probe.login)}</li>
        <li>
          {session === "default"
            ? "Starts now, then World connects to it"
            : `Starts its "${session}" session now, then World connects to it`}
        </li>
        {probe.herdr ? (
          <li>
            Herdr at <code>{probe.herdr}</code> stays as it is
          </li>
        ) : null}
      </ul>
      <div className="connection-profile-actions">
        <button type="button" data-initial-focus onClick={onConfirm}>
          <Download size={14} />{" "}
          {simulated
            ? installed
              ? "Simulate start and connect (test)"
              : "Simulate install and start (test)"
            : installed
              ? "Start and connect"
              : "Install and start"}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}
