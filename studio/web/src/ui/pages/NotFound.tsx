import { Link } from "react-router-dom";
import { Home } from "lucide-react";

export function NotFound() {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-[#27272A] bg-[#0A0A0A] p-6 text-center">
      <p className="text-sm font-mono text-[#71717a]">404</p>
      <h1 className="mt-1 font-semibold text-white">halaman tidak ada</h1>
      <p className="mt-1 text-sm text-[#a1a1aa]">url ini tidak ada — mungkin typo atau job id salah</p>
      <Link to="/" className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#B6FF3B] px-4 py-2 text-sm font-bold text-black hover:bg-[#9AE600]">
        <Home className="h-4 w-4" /> dashboard
      </Link>
      <p className="mt-3 text-xs text-[#71717a]">
        <code className="rounded bg-[#000000] border border-[#27272A] px-1">/</code> <code className="rounded bg-[#000000] border border-[#27272A] px-1">/new</code>{" "}
        <code className="rounded bg-[#000000] border border-[#27272A] px-1">/jobs/:id</code> <code className="rounded bg-[#000000] border border-[#27272A] px-1">/templates</code>
      </p>
    </div>
  );
}
