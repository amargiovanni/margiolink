import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light" | "system";

const KEY = "margiolink:theme";

/** Reading storage can throw — a private window, blocked site data. A theme is
 *  a convenience, so failure means "follow the system", never an error. */
export function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "dark" || stored === "light" ? stored : "system";
  } catch {
    return "system";
  }
}

export function storeTheme(theme: Theme): void {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Not being able to remember the choice is survivable.
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/** System, Light or Dark. "System" removes the stamp entirely so the media
 *  query in tokens.css decides; the other two stamp it so the explicit
 *  choice wins in both directions. */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    storeTheme(next);
    setThemeState(next);
  }, []);

  return { theme, setTheme };
}
