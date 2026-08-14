import { useCallback, useEffect, useState } from "react";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = "manu.theme";

function isTheme(value: string | null): value is Theme {
  return value !== null && (THEMES as readonly string[]).includes(value);
}

/**
 * What a fresh install uses.
 *
 * Manu Dark, not the desktop's setting. The audit found the opposite: the
 * default was "system", most desktops report light, and so most people met Manu
 * as a cream document application — precisely the thing the brand direction
 * rejects (MANU-A). Following the OS is still offered and still remembered; it
 * is simply not what an unconfigured Manu looks like.
 */
const DEFAULT_THEME: Theme = "dark";

function read(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : DEFAULT_THEME;
  } catch {
    // Private-mode or a locked-down webview: the default still applies.
    return DEFAULT_THEME;
  }
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/**
 * The writer's choice of Manu Black, Paper, or whatever the desktop says.
 *
 * Manu Black is the default and Paper is a first-class alternative — the light
 * palette is complete and stays supported. "System" is offered for people who
 * want the application to follow their desktop; it is a choice rather than the
 * starting point.
 */
export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(read);

  useEffect(() => {
    apply(theme);
  }, [theme]);

  const choose = useCallback((next: Theme) => {
    setTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not being able to remember the choice is not a reason to refuse it.
    }
  }, []);

  return [theme, choose];
}
