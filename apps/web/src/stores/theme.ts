import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark" | "system";
const dark = (t: Theme) => t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
export const applyTheme = (t: Theme) => document.documentElement.classList.toggle("dark", dark(t));

export const useTheme = create<{ theme: Theme; setTheme: (t: Theme) => void }>()(
  persist(
    (set) => ({ theme: "system", setTheme: (theme) => { applyTheme(theme); set({ theme }); } }),
    { name: "wp-theme" },
  ),
);
