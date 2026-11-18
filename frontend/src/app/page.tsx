"use client";

import { useState, useEffect, useCallback } from "react";
import Lessons from "@/components/Lessons";
import Reviews from "@/components/Reviews";
import ReviewSchedule from "@/components/ReviewSchedule";
import DailyCheckInDialog from "@/components/DailyCheckInDialog";
import HardestItems from "@/components/HardestItems";
import { apiFetch } from "@/lib/api-client";

interface DashboardStats {
  learnCount: number;
  reviewingCount: number;
  masteredCount: number;
  nextReviewAt: string | null;
  reviewCount: number;
  reviewsDue: number;
  schedule: {
    date: string;
    isToday: boolean;
    count: number;
    runningTotal: number;
    label: string;
  }[];
  streak: number;
}

export default function DashboardPage() {
  const [dailyPlan, setDailyPlan] = useState<any>(null);
  const [showCheckIn, setShowCheckIn] = useState(false);

  const [stats, setStats] = useState<DashboardStats>({
    learnCount: 0,
    reviewingCount: 0,
    masteredCount: 0,
    nextReviewAt: null,
    reviewCount: 0,
    reviewsDue: 0,
    schedule: [],
    streak: 0,
  });

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
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    async function checkDailyPlan() {
      try {
        const res = await apiFetch("/api/daily-plan/check", { method: "POST" });
        if (!res.ok) return;
        const { isNewDay, plan } = await res.json();
        setDailyPlan(plan);
        localStorage.setItem("lastDailyPlanDate", plan.date);
        window.dispatchEvent(new Event("dailyPlanChecked"));
        if (isNewDay) {
          setShowCheckIn(true);
        }
      } catch {
        // non-critical — silently ignore
      }
    }
    checkDailyPlan();
  }, []);

  useEffect(() => {
    const handleRefreshStats = () => {
      console.log("Dashboard: Heard refreshStats event, refetching...");
      fetchStats();
    };

    window.addEventListener("refreshStats", handleRefreshStats);

    return () => {
      window.removeEventListener("refreshStats", handleRefreshStats);
    };
  }, [fetchStats]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("Page has become visible, refreshing stats...");
        fetchStats();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchStats]);
  return (
    <div className="container mx-auto max-w-6xl px-4 py-8">
      {showCheckIn && dailyPlan && (
        <DailyCheckInDialog
          plan={dailyPlan}
          learnCount={stats.learnCount}
          onClose={() => setShowCheckIn(false)}
        />
      )}

      <h1 className="text-3xl font-bold mb-8 text-center text-gray-800 dark:text-white">
        Dashboard
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <div className="h-full">
          <Lessons
            learningCount={stats.learnCount}
            reviewingCount={stats.reviewingCount}
            masteredCount={stats.masteredCount}
          />
        </div>
        <div className="h-full">
          <Reviews reviewsDue={stats.reviewsDue} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 mb-8">
        <div className="h-full">
          <ReviewSchedule
            nextReviewAt={stats.nextReviewAt}
            schedule={stats.schedule}
            reviewsDue={stats.reviewsDue}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 mb-8">
        <HardestItems />
      </div>
    </div>
  );
}
