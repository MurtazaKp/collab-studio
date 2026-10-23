"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type ThemePref = "light" | "dark" | "system";

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function read(): ThemePref {
  try {
    const v = localStorage.getItem("cv-theme");
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function useThemePreference(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => {
    setPref(read());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (read() === "system") apply("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return [
    pref,
    (p) => {
      setPref(p);
      try {
        if (p === "system") localStorage.removeItem("cv-theme");
        else localStorage.setItem("cv-theme", p);
      } catch {
        // Storage may be unavailable (private mode); the choice still applies now.
      }
      apply(p);
    },
  ];
}

export function ThemeSwitcher() {
  const [pref, setPref] = useThemePreference();
  const options: { value: ThemePref; label: string; icon: React.ReactNode }[] = [
    { value: "light", label: "Light", icon: <Sun className="size-4" /> },
    { value: "dark", label: "Dark", icon: <Moon className="size-4" /> },
    { value: "system", label: "System", icon: <Monitor className="size-4" /> },
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={pref === o.value}
          onClick={() => setPref(o.value)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors",
            pref === o.value ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
