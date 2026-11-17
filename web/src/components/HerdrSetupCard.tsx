import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  Download,
  LoaderCircle,
  Server,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { useGreetingHold } from "../world/townMasterGreeting";
import { CoreInstallPanel } from "./CoreInstall";
import "./HerdrSetupCard.css";

type SetupInfo = {
  state: "missing" | "installed";
  verified_version: string;
};

export function HerdrSetupCard({
  compact = false,
  enabled = true,
  children = null,
  holdGreeting = false,
}: {
  compact?: boolean;
  enabled?: boolean;
  children?: ReactNode;
  /** Town: the Town Master's greeting waits while this card is on screen. */
  holdGreeting?: boolean;
}) {
  const titleId = useId();
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [confirming, setConfirming] = useState(false);
  // With no runtime at all, herdr-core comes first; the Herdr TUI is second.
  const [coreOpen, setCoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestInProgress = useRef(false);
  const reviewButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/herdr/status", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((status) => {
        if (controller.signal.aborted) return;
        if (
          status?.can_setup === true &&
          (status.state === "missing" || status.state === "installed") &&
          typeof status.verified_version === "string"
        ) {
          setInfo(status);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => controller.abort();
  }, [enabled]);

  // Held while checking too, so the greeting never opens under a card that
  // is about to appear; released when setup is unavailable (#935).
  useGreetingHold(holdGreeting && enabled && (checking || info !== null));

  function cancel() {
    setConfirming(false);
    requestAnimationFrame(() => reviewButton.current?.focus());
  }

  async function setup() {
    if (requestInProgress.current) return;
    requestInProgress.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/herdr/setup", {
        method: "POST",
        credentials: "same-origin",
        headers: { "x-herdr-world-herdr-setup": "1" },
      });
      const result = await response.json();
      if (!response.ok || result?.ok !== true) {
        throw new Error(
          result?.error ?? "Herdr setup could not complete. Please try again.",
        );
      }
      window.location.reload();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Herdr setup could not complete.",
      );
      setBusy(false);
      requestInProgress.current = false;
    }
  }

  if (!enabled) return children;
  if (checking) {
    return compact ? null : (
      <div className="herdr-setup-checking" role="status">
        <LoaderCircle
          size={16}
          className="herdr-setup-spinner"
          aria-hidden="true"
        />
        Checking Herdr connection
      </div>
    );
  }
  if (!info) return children;

  const missing = info.state === "missing";
  const coreFirst = missing && !confirming && !busy;
  const title = busy
    ? "Setting up Herdr"
    : confirming
      ? missing
        ? `Install Herdr ${info.verified_version}?`
        : "Start Herdr as a service?"
      : missing
        ? "Your workspace starts here"
        : "Bring your workspace online";

  return (
    <section
      className={`herdr-setup-card${compact ? " herdr-setup-card-compact" : ""}`}
      aria-labelledby={titleId}
      aria-busy={busy}
      onKeyDown={(event) => {
        if (event.key === "Escape" && confirming && !busy) {
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <div className="herdr-setup-heading">
        <span className="herdr-setup-mark" aria-hidden="true">
          <Terminal size={24} />
        </span>
        <span className="herdr-setup-eyebrow">
          {missing ? "FIRST-TIME SETUP" : "HERDR SERVER"}
        </span>
        <span className="herdr-setup-badge">
          {missing ? (
            <ShieldCheck size={13} aria-hidden="true" />
          ) : (
            <Server size={13} aria-hidden="true" />
          )}
          {coreFirst
            ? "Checksum-verified"
            : missing
              ? `Verified ${info.verified_version}`
              : "Installed"}
        </span>
      </div>

      <div className="herdr-setup-intro" aria-live="polite">
        <h2 id={titleId}>{title}</h2>
        <p>
          {busy
            ? "Keep this page open. Herdr World will reconnect when Herdr is ready."
            : confirming
              ? "This changes the machine running Herdr World, not your browser or a remote SSH host."
              : missing
                ? "herdr-core runs your terminals and agents. Set it up once on this computer, then manage your workspace from here."
                : "Herdr is installed but isn't running. Start it in the background to reconnect your terminals and agents."}
        </p>
      </div>

      {coreOpen ? (
        <CoreInstallPanel
          host={{ type: "local" }}
          onClose={() => {
            setCoreOpen(false);
            requestAnimationFrame(() => reviewButton.current?.focus());
          }}
        />
      ) : coreFirst ? (
        <ul className="herdr-setup-steps">
          <li>
            <Download size={18} aria-hidden="true" />
            <div>
              <strong>herdr-core, the newest release</strong>
              <span>From releases.herdr.dev, checked with SHA-256</span>
            </div>
          </li>
          <li>
            <Server size={18} aria-hidden="true" />
            <div>
              <strong>Starts now and at login</strong>
              <span>Independently of Herdr World, which then connects</span>
            </div>
          </li>
        </ul>
      ) : busy ? (
        <div className="herdr-setup-progress" role="status">
          <LoaderCircle
            size={18}
            className="herdr-setup-spinner"
            aria-hidden="true"
          />
          <div>
            <strong>
              {missing
                ? "Installing and starting the service"
                : "Starting the service"}
            </strong>
            <span>This may take a few minutes.</span>
          </div>
        </div>
      ) : (
        <ul className="herdr-setup-steps">
          <li>
            {missing ? (
              <Download size={18} aria-hidden="true" />
            ) : (
              <Check size={18} aria-hidden="true" />
            )}
            <div>
              <strong>
                {missing
                  ? `Herdr ${info.verified_version}`
                  : "Use your existing installation"}
              </strong>
              <span>
                {missing
                  ? "Verified release with SHA-256 checks"
                  : "Your Herdr binary stays unchanged"}
              </span>
            </div>
          </li>
          <li>
            <Server size={18} aria-hidden="true" />
            <div>
              <strong>Run as a background service</strong>
              <span>Starts at login, independently of Herdr World</span>
            </div>
          </li>
        </ul>
      )}

      {error ? (
        <div className="herdr-setup-error" role="alert">
          <strong>Setup couldn't finish</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <div className="herdr-setup-footer" hidden={coreOpen}>
        {coreFirst ? (
          <div className="herdr-setup-actions">
            <button
              ref={reviewButton}
              type="button"
              className="herdr-setup-primary"
              onClick={() => setCoreOpen(true)}
            >
              Set up herdr-core
              <ArrowRight size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="herdr-setup-cancel"
              onClick={() => setConfirming(true)}
            >
              Use the Herdr TUI instead
            </button>
          </div>
        ) : confirming ? (
          <div className="herdr-setup-actions">
            <button
              type="button"
              className="herdr-setup-primary"
              disabled={busy}
              onClick={() => void setup()}
            >
              {busy
                ? "Setting up..."
                : error
                  ? "Try again"
                  : missing
                    ? "Install & start"
                    : "Start service"}
              {!busy ? <ArrowRight size={16} aria-hidden="true" /> : null}
            </button>
            <button
              type="button"
              className="herdr-setup-cancel"
              disabled={busy}
              onClick={cancel}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            ref={reviewButton}
            type="button"
            className="herdr-setup-primary"
            onClick={() => setConfirming(true)}
          >
            {missing ? "Set up Herdr" : "Start Herdr"}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
        <p className="herdr-setup-footnote">
          {confirming
            ? "A user service will be registered on the Herdr World host."
            : "Review the details before making any changes."}
        </p>
      </div>
    </section>
  );
}
