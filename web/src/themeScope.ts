import { createContext, useContext, useEffect, useState } from "react";

export type AppTheme = "dark" | "light";

/**
 * A window drawn in one theme whatever the app's theme, such as Town's dark
 * agent window. Its CSS scope is `.theme-scope-dark` in tokens.css.
 */
export const ThemeScope = createContext<AppTheme | null>(null);

function documentTheme(): AppTheme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** The theme a viewer draws code in: its window's scope, else the app's. */
export function useViewTheme(): AppTheme {
  const scoped = useContext(ThemeScope);
  const [theme, setTheme] = useState<AppTheme>(() => documentTheme());

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(documentTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return scoped ?? theme;
}
