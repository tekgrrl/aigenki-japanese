"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/providers/AuthProvider";
import { AvatarMenu } from "./AvatarMenu";
import { applyFurigana, loadFurigana } from "@/lib/furigana";

/**
 * Global navigation header.
 * Hidden entirely when there is no authenticated user (e.g. on the login page).
 */
export default function Header() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ learnCount: 0, reviewingCount: 0, reviewsDue: 0, simulateCount: 0 });
  const [showDailyNudge, setShowDailyNudge] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const response = await apiFetch("/api/stats");
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error("Failed to fetch stats:", error);
    }
  }, []);

  useEffect(() => {
    if (user) fetchStats();
  }, [user, fetchStats]);

  useEffect(() => {
    const handleRefreshStats = () => fetchStats();
    window.addEventListener("refreshStats", handleRefreshStats);
    return () => window.removeEventListener("refreshStats", handleRefreshStats);
  }, [fetchStats]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") fetchStats();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [fetchStats]);

  useEffect(() => {
    if (!user) return;
    const today = new Date().toISOString().slice(0, 10);
    const last = localStorage.getItem("lastDailyPlanDate");
    setShowDailyNudge(last !== today);

    const handleStorage = () => {
      setShowDailyNudge(localStorage.getItem("lastDailyPlanDate") !== today);
    };
    window.addEventListener("storage", handleStorage);
    // Also listen for same-tab updates via a custom event
    window.addEventListener("dailyPlanChecked", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("dailyPlanChecked", handleStorage);
    };
  }, [user]);

  // Apply saved furigana preference on load
  useEffect(() => {
    applyFurigana(loadFurigana());
  }, []);

  // Alt+F global keyboard shortcut — toggles furigana and persists to backend
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.altKey &&
        (e.key === "f" || e.key === "F" || e.code === "KeyF")
      ) {
        e.preventDefault();
        const next = !loadFurigana();
        applyFurigana(next);
        apiFetch("/api/users/me/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ showFurigana: next }),
        }).catch(() => {});
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!user) return null;

  return (
    <header className="bg-shodo-paper border-b border-shodo-ink/10 shadow-sm sticky top-0 z-10">
      <nav className="container mx-auto max-w-4xl px-8 py-4 flex items-center">
        <Link
          href="/"
          className="relative text-2xl font-bold text-shodo-ink hover:text-shodo-accent transition-colors duration-200 mr-auto"
        >
          AIGENKI
          {showDailyNudge && (
            <span
              className="absolute -top-1 -right-3 flex h-2.5 w-2.5"
              title="Visit the dashboard for your daily check-in"
            >
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-shodo-accent opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-shodo-accent" />
            </span>
          )}
        </Link>

        {/* Primary navigation */}
        <div className="flex items-center space-x-2 sm:space-x-4">
          <Link
            href="/learn"
            className="whitespace-nowrap px-4 py-2 rounded-md text-shodo-ink font-medium hover:bg-shodo-ink/5 transition-colors duration-200"
          >
            Learn ({stats.learnCount}/{stats.reviewingCount})
          </Link>
          <Link
            href="/review"
            className="whitespace-nowrap px-4 py-2 rounded-md text-shodo-ink font-medium hover:bg-shodo-ink/5 transition-colors duration-200"
          >
            Review ({stats.reviewsDue})
          </Link>
          <Link
            href="/scenarios"
            className="whitespace-nowrap px-4 py-2 rounded-md text-shodo-ink font-medium hover:bg-shodo-ink/5 transition-colors duration-200"
          >
            Scenarios ({stats.simulateCount})
          </Link>
          <Link
            href="/concepts"
            className="px-4 py-2 rounded-md text-shodo-ink font-medium hover:bg-shodo-ink/5 transition-colors duration-200"
          >
            Concepts
          </Link>
        </div>

        {/* Avatar menu — profile, library, manage, sign out */}
        <div className="ml-4">
          <AvatarMenu />
        </div>
      </nav>
    </header>
  );
}
