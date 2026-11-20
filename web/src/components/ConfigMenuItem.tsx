import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/** One row of the Menu: an icon, a label, a line of detail and a chevron. */
export function ConfigMenuItem({
  icon,
  label,
  description,
  onClick,
  disabled = false,
  primary = false,
  className,
}: {
  icon: ReactNode;
  label: string;
  description?: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`config-menu-item${primary ? " is-primary" : ""}${className ? ` ${className}` : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="config-item-icon">{icon}</span>
      <span className="config-item-copy">
        <strong>{label}</strong>
        {description ? <span>{description}</span> : null}
      </span>
      <ChevronRight size={15} />
    </button>
  );
}
