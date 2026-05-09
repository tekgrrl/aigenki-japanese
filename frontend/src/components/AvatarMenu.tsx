"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/providers/AuthProvider";
import { UserAvatar } from "./UserAvatar";
import { applyFurigana, loadFurigana } from "@/lib/furigana";
import { apiFetch } from "@/lib/api-client";

export function AvatarMenu() {
  const { user, signOut, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [showFurigana, setShowFurigana] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setShowFurigana(loadFurigana());
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  if (!user?.email) return null;

  const handleToggleFurigana = () => {
    const next = !showFurigana;
    setShowFurigana(next);
    applyFurigana(next);
    apiFetch("/api/users/me/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ showFurigana: next }),
    }).catch(() => {});
  };

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-full focus:outline-none focus:ring-2 focus:ring-shodo-accent focus:ring-offset-2 focus:ring-offset-shodo-paper"
        aria-label="User menu"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <UserAvatar email={user.email} size="sm" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-52 bg-shodo-paper border border-shodo-ink/10 rounded-lg shadow-lg py-1 z-50">
          <div className="px-3 py-2 border-b border-shodo-ink/10">
            <p className="text-xs text-shodo-ink/50 truncate">{user.email}</p>
          </div>

          <Link
            href="/profile"
            className="block px-3 py-2 text-sm text-shodo-ink hover:bg-shodo-ink/5 transition-colors"
            onClick={() => setOpen(false)}
          >
            Profile &amp; Settings
          </Link>

          <button
            onClick={handleToggleFurigana}
            className="flex w-full items-center justify-between px-3 py-2 text-sm text-shodo-ink hover:bg-shodo-ink/5 transition-colors"
          >
            <span>Furigana</span>
            <span
              role="switch"
              aria-checked={showFurigana}
              className={`relative ml-3 w-8 h-4 rounded-full shrink-0 transition-colors duration-200 ${showFurigana ? "bg-shodo-ink" : "bg-shodo-ink/20"}`}
            >
              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-shodo-paper shadow-sm transition-all duration-200 ${showFurigana ? "left-4" : "left-0.5"}`} />
            </span>
          </button>

          <div className="h-px bg-shodo-ink/10 my-1" />

          <Link
            href="/library"
            className="block px-3 py-2 text-sm text-shodo-ink hover:bg-shodo-ink/5 transition-colors"
            onClick={() => setOpen(false)}
          >
            Library
          </Link>
          <Link
            href="/manage"
            className="block px-3 py-2 text-sm text-shodo-ink hover:bg-shodo-ink/5 transition-colors"
            onClick={() => setOpen(false)}
          >
            Manage
          </Link>

          {isAdmin && (
            <>
              <div className="h-px bg-shodo-ink/10 my-1" />
              <p className="px-3 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-widest text-shodo-ink/30">
                Admin
              </p>
              <Link href="/admin/knowledge-units" className="block px-3 py-2 text-sm text-shodo-ink hover:bg-shodo-ink/5 transition-colors" onClick={() => setOpen(false)}>
                Knowledge Units
              </Link>
              <Link href="/admin/concepts" className="block px-3 py-2 text-sm text-shodo-ink hover:bg-shodo-ink/5 transition-colors" onClick={() => setOpen(false)}>
                Concepts
              </Link>
              <Link href="/admin/prompt-tester" className="block px-3 py-2 text-sm text-shodo-ink hover:bg-shodo-ink/5 transition-colors" onClick={() => setOpen(false)}>
                Prompt Tester
              </Link>
              <Link href="/admin/logs" className="block px-3 py-2 text-sm text-shodo-ink hover:bg-shodo-ink/5 transition-colors" onClick={() => setOpen(false)}>
                API Logs
              </Link>
            </>
          )}

          <div className="h-px bg-shodo-ink/10 my-1" />

          <button
            onClick={handleSignOut}
            className="block w-full text-left px-3 py-2 text-sm text-shodo-ink/50 hover:text-shodo-ink hover:bg-shodo-ink/5 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
