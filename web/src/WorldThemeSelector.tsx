import { Building2, ChevronDown, Network } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import type { WorldThemeDefinition } from "./world/worldThemeRegistry";

export function WorldThemeSelector({
  themes,
  activeTheme,
  worldActive,
  onSelect,
}: {
  themes: readonly WorldThemeDefinition[];
  activeTheme: WorldThemeDefinition;
  worldActive: boolean;
  onSelect: (themeId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const restoreTriggerFocus = () => {
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  };
  const dismiss = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) {
      restoreTriggerFocus();
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const selected = menuRef.current?.querySelector<HTMLElement>("[aria-checked='true']");
    const frame = window.requestAnimationFrame(() => selected?.focus());
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !menuRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        dismiss();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']")];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      items[index]?.click();
      return;
    }
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") {
      nextIndex = index < 0 || index === items.length - 1 ? 0 : index + 1;
    } else if (event.key === "ArrowUp") {
      nextIndex = index <= 0 ? items.length - 1 : index - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    }
    if (nextIndex !== null) {
      event.preventDefault();
      items[nextIndex]?.focus();
    }
  };

  const Icon = activeTheme.id === "graph" ? Network : Building2;
  return (
    <div className="world-theme-selector">
      <button
        ref={triggerRef}
        type="button"
        data-on={worldActive}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            dismiss();
          }
        }}
      >
        <Icon size={14} aria-hidden="true" />
        <span>{activeTheme.label}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          className="world-theme-menu"
          role="menu"
          aria-label="World themes"
          onKeyDown={onMenuKeyDown}
        >
          {themes.map((theme) => {
            const ThemeIcon = theme.id === "graph" ? Network : Building2;
            return (
              <button
                key={theme.id}
                type="button"
                role="menuitemradio"
                aria-label={theme.label}
                aria-checked={theme.id === activeTheme.id}
                onClick={() => {
                  onSelect(theme.id);
                  dismiss();
                }}
              >
                <ThemeIcon size={14} aria-hidden="true" />
                <span>{theme.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
