import { Link, NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { Film, LayoutDashboard, Clapperboard, Palette, Sun, Moon, ExternalLink } from "lucide-react";
import { useAppStore } from "@/app/stores/appStore";

const nav = [
  { to: "/", label: "projects", icon: LayoutDashboard },
  { to: "/new", label: "new clip", icon: Clapperboard },
  { to: "/templates", label: "templates", icon: Palette },
];

export function AppShell({ children }: { children?: React.ReactNode }) {
  const { theme, toggleTheme } = useAppStore();
  const navTo = useNavigate();
  const loc = useLocation();

  return (
    <div className="min-h-dvh bg-[#000000] text-zinc-100 flex">
      {/* sidebar — keep it simple, lime only on active */}
      <aside className="hidden lg:flex w-[220px] shrink-0 flex-col border-r border-[#27272A] bg-[#111111] sticky top-0 h-dvh">
        <div className="flex h-[56px] items-center gap-3 px-4 border-b border-[#27272A]">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#B6FF3B] text-black">
            <Film className="h-4 w-4" />
          </span>
          <span className="text-sm font-bold tracking-tight">
            movie<span className="text-[#B6FF3B]">2</span>short
          </span>
        </div>

        <nav className="flex-1 px-2 py-4 space-y-1">
          {nav.map((n) => {
            const on = loc.pathname === n.to || (n.to !== "/" && loc.pathname.startsWith(n.to));
            return (
              <NavLink
                key={n.to}
                to={n.to}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${on ? "bg-[#1A1A1A] text-white" : "text-[#a1a1aa] hover:text-white hover:bg-[#0A0A0A]"}`}
              >
                {on && <span className="h-5 w-1 rounded-full bg-[#B6FF3B]" />}
                <n.icon className="h-4 w-4" />
                {n.label}
                {on && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#B6FF3B]" />}
              </NavLink>
            );
          })}

          {/* NB: promo kept but toned down — old gradient was slop */}
          <div className="mt-6 rounded-xl border border-[#27272A] bg-[#0A0A0A] p-3">
            <p className="text-xs font-semibold text-white">one shot pipeline</p>
            <p className="mt-1 text-xs leading-relaxed text-[#a1a1aa]">analysis → tts → ffmpeg → caption. no browser export, ffmpeg is source of truth.</p>
            <button onClick={() => navTo("/new")} className="mt-3 w-full rounded-full bg-[#B6FF3B] py-2 text-xs font-bold text-black hover:bg-[#9AE600]">
              new clip
            </button>
          </div>
        </nav>

        <div className="border-t border-[#27272A] p-2 flex items-center gap-1">
          <button
            onClick={toggleTheme}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-full bg-[#0A0A0A] border border-[#27272A] py-2 text-xs text-[#a1a1aa] hover:text-white"
          >
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            {theme}
          </button>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#0A0A0A] border border-[#27272A] text-[#a1a1aa] hover:text-white"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-[#27272A] bg-[#000000]/90 backdrop-blur px-4">
          <Link to="/" className="lg:hidden flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#B6FF3B] text-black">
              <Film className="h-3.5 w-3.5" />
            </span>
            <span className="text-sm font-bold">movie2short</span>
          </Link>

          <div className="hidden lg:flex items-center gap-2 text-xs text-[#71717a]">
            <span className="rounded-full bg-[#0A0A0A] border border-[#27272A] px-2.5 py-1">local • sandbox</span>
            <span className="rounded-full bg-[#0A0A0A] border border-[#27272A] px-2.5 py-1">1080×1920</span>
          </div>

          <button
            onClick={() => navTo("/new")}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#B6FF3B] px-4 py-2 text-sm font-bold text-black hover:bg-[#9AE600]"
          >
            new clip
          </button>
        </header>

        <div className="flex gap-1 border-b border-[#27272A] bg-[#111111] px-2 py-2 lg:hidden overflow-auto">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) => `shrink-0 rounded-full px-3 py-1.5 text-sm ${isActive ? "bg-[#B6FF3B] text-black font-bold" : "bg-[#1A1A1A] text-[#a1a1aa]"}`}
            >
              {n.label}
            </NavLink>
          ))}
        </div>

        <main className="flex-1 px-4 py-6 lg:px-6">{children ?? <Outlet />}</main>

        <footer className="border-t border-[#27272A] py-3 text-center text-xs text-[#71717a]">movie2short — ffmpeg is truth, browser is preview</footer>
      </div>
    </div>
  );
}
