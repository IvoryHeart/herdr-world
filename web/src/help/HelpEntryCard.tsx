import type { HelpEntry } from "./helpEntry";
import { helpPictureUrl } from "./helpEntry";
import { helpPictureLook } from "./greetingNews";

/**
 * One help entry as World shows it: its picture for this screen, what it
 * is, the steps, where it lives, and Try.
 */
export function HelpEntryCard({
  entry,
  mobile,
  onTry,
}: {
  entry: HelpEntry;
  mobile: boolean;
  onTry(entry: HelpEntry): void;
}) {
  const look = helpPictureLook(mobile);
  return (
    <li className="help-entry" data-entry={entry.id}>
      <img
        src={helpPictureUrl(entry, look.size, look.theme)}
        alt={`${entry.title}: ${entry.where}`}
        loading="lazy"
      />
      <div className="help-entry-text">
        <h3>{entry.title}</h3>
        <p>{entry.summary}</p>
        <ol>
          {entry.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="help-entry-where">
          <span>Where:</span> {entry.where}
        </p>
        <button
          type="button"
          className="help-entry-try"
          aria-label={`Try ${entry.title}`}
          onClick={() => onTry(entry)}
        >
          Try
        </button>
      </div>
    </li>
  );
}
