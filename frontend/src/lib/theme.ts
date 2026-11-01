/**
 * Light / dark theme for the Shodo palette.
 *
 * The choice is per device (localStorage), not a backend preference — the reason for
 * dark mode is usually the machine's night light, not the user. 'system' follows the
 * OS/browser `prefers-color-scheme`. Applied as html[data-theme="dark"], which
 * globals.css uses to swap the --shodo-* variables.
 *
 * Mirrors lib/furigana.ts. THEME_INIT_SCRIPT is inlined in layout.tsx so the theme is
 * applied before first paint (no flash of the light theme).
 */

export type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function loadTheme(): ThemeChoice {
  if (typeof localStorage === "undefined") return "system";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

function resolvesDark(choice: ThemeChoice): boolean {
  if (choice === "dark") return true;
  if (choice === "light") return false;
  return typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches;
}

export function applyTheme(choice: ThemeChoice) {
  if (typeof document === "undefined") return;
  if (resolvesDark(choice)) {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

export function saveTheme(choice: ThemeChoice) {
  if (typeof localStorage !== "undefined") {
    if (choice === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  }
  applyTheme(choice);
}

/** Re-apply when the OS setting changes while 'system' is selected. Returns an unsubscribe. */
export function watchSystemTheme(): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(DARK_QUERY);
  const onChange = () => {
    if (loadTheme() === "system") applyTheme("system");
  };
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Runs inline in <head> before paint. Must stay self-contained (no imports). */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});if(t==="dark"||(t!=="light"&&window.matchMedia(${JSON.stringify(DARK_QUERY)}).matches)){document.documentElement.setAttribute("data-theme","dark");}}catch(e){}})();`;
