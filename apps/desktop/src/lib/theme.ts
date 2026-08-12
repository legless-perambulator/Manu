import { useCallback, useEffect, useState } from "react";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = "manu.theme";

function isTheme(value: string | null): value is Theme {
  return value !== null && (THEMES as readonly string[]).includes(value);
}

function read(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : "system";
  } catch {
    // Private-mode or a locked-down webview: fall back to the system setting.
    return "system";
  }
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/**
 * The writer's choice of Paper or Manu Black, remembered. "system" leaves the
 * decision to the operating system, which is the default: an application that
 * ignores the desktop it is running on looks like a prototype.
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
