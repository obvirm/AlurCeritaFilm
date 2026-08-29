import { create } from "zustand";

type Theme = "dark" | "light";

interface AppState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  lastVideoPath: string | null;
  setLastVideoPath: (p: string | null) => void;
}

function initialTheme(): Theme {
  try {
    const v = localStorage.getItem("m2s:theme");
    if (v === "light" || v === "dark") return v;
  } catch {}
  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function initialVideoPath() {
  try {
    return localStorage.getItem("m2s:lastVideoPath");
  } catch {
    return null;
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  theme: initialTheme(),
  lastVideoPath: initialVideoPath(),

  setTheme(theme) {
    set({ theme });
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("m2s:theme", theme);
    } catch {}
  },

  toggleTheme() {
    get().setTheme(get().theme === "dark" ? "light" : "dark");
  },

  setLastVideoPath(p) {
    set({ lastVideoPath: p });
    try {
      p ? localStorage.setItem("m2s:lastVideoPath", p) : localStorage.removeItem("m2s:lastVideoPath");
    } catch {}
  },
}));
