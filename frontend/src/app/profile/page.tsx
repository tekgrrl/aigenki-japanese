"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { UserAvatar } from "@/components/UserAvatar";
import { apiFetch } from "@/lib/api-client";
import { applyFurigana, loadFurigana } from "@/lib/furigana";
import { loadTheme, saveTheme, type ThemeChoice } from "@/lib/theme";

const JLPT_LEVELS = ["N5", "N4", "N3", "N2", "N1"] as const;
const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export default function ProfilePage() {
  const { user } = useAuth();
  const [showFurigana, setShowFurigana] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [jlptLevel, setJlptLevel] = useState<string>("");
  const [preferredUserRole, setPreferredUserRole] = useState<string>("");
  const [audioFirst, setAudioFirst] = useState(false);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setShowFurigana(loadFurigana());
    setTheme(loadTheme());

    Promise.all([
      apiFetch("/api/users/me").then((r) => r.json()),
      apiFetch("/api/scenarios/roles").then((r) => r.json()),
    ])
      .then(([userData, rolesData]) => {
        if (userData.preferences?.showFurigana !== undefined) {
          const val = Boolean(userData.preferences.showFurigana);
          setShowFurigana(val);
          applyFurigana(val);
        }
        if (userData.preferences?.jlptLevel) setJlptLevel(userData.preferences.jlptLevel);
        if (userData.preferences?.preferredUserRole) setPreferredUserRole(userData.preferences.preferredUserRole);
        setAudioFirst(userData.preferences?.audioFirstExperiment === true);
        if (Array.isArray(rolesData.userRoles)) setUserRoles(rolesData.userRoles);
      })
      .catch(() => {});
  }, []);

  const patchPreferences = useCallback(async (patch: Record<string, unknown>) => {
    setSaving(true);
    setSaved(false);
    try {
      await apiFetch("/api/users/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // best-effort; UI already reflects the optimistic update
    } finally {
      setSaving(false);
    }
  }, []);

  const handleToggleFurigana = useCallback(async () => {
    const newVal = !showFurigana;
    setShowFurigana(newVal);
    applyFurigana(newVal);
    await patchPreferences({ showFurigana: newVal });
  }, [showFurigana, patchPreferences]);

  const handleToggleAudioFirst = useCallback(async () => {
    const next = !audioFirst;
    setAudioFirst(next);
    await patchPreferences({ audioFirstExperiment: next });
  }, [audioFirst, patchPreferences]);

  const handleJlptLevel = useCallback(async (val: string) => {
    setJlptLevel(val);
    await patchPreferences({ jlptLevel: val || null });
  }, [patchPreferences]);

  const handlePreferredUserRole = useCallback(async (val: string) => {
    setPreferredUserRole(val);
    await patchPreferences({ preferredUserRole: val || null });
  }, [patchPreferences]);

  if (!user?.email) return null;

  return (
    <main className="container mx-auto max-w-2xl px-8 py-12">
      <h1 className="text-2xl font-bold text-shodo-ink mb-10">Profile</h1>

      {/* Identity */}
      <div className="flex items-center gap-5 mb-12">
        <UserAvatar email={user.email} size="lg" />
        <div>
          <p className="text-lg font-medium text-shodo-ink">{user.email}</p>
          <p className="text-sm text-shodo-ink/50">Learner</p>
        </div>
      </div>

      {/* Settings */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-shodo-ink/40 mb-4">
          Settings
        </h2>
        <div className="border border-shodo-ink/10 rounded-lg divide-y divide-shodo-ink/10">
          {/* Furigana toggle */}
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-sm font-medium text-shodo-ink">Show Furigana</p>
              <p className="text-xs text-shodo-ink/50 mt-0.5">
                Display reading aids above kanji — shortcut: Alt+F
              </p>
            </div>
            <div className="flex items-center gap-3 ml-4 shrink-0">
              {saving && (
                <span className="text-xs text-shodo-ink/40">Saving…</span>
              )}
              {saved && (
                <span className="text-xs text-green-600">Saved</span>
              )}
              <button
                onClick={handleToggleFurigana}
                role="switch"
                aria-checked={showFurigana}
                className={`relative w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-shodo-accent focus:ring-offset-2 ${
                  showFurigana ? "bg-shodo-ink" : "bg-shodo-ink/20"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-shodo-paper shadow-sm transition-all duration-200 ${
                    showFurigana ? "left-5" : "left-0.5"
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Audio-first experiment (#246) */}
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-sm font-medium text-shodo-ink">Audio-first vocab (experimental)</p>
              <p className="text-xs text-shodo-ink/50 mt-0.5">
                New words that have pictures are learned by picture and sound, with no kanji or kana.
                Words you&apos;re already learning aren&apos;t affected.
              </p>
            </div>
            <button
              type="button"
              onClick={handleToggleAudioFirst}
              role="switch"
              aria-checked={audioFirst}
              aria-label="Audio-first vocab (experimental)"
              className={`relative ml-4 shrink-0 w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-shodo-accent focus:ring-offset-2 ${
                audioFirst ? "bg-shodo-ink" : "bg-shodo-ink/20"
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-shodo-paper shadow-sm transition-all duration-200 ${
                  audioFirst ? "left-5" : "left-0.5"
                }`}
              />
            </button>
          </div>

          {/* Appearance (per device — stored in this browser, not on the account) */}
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-sm font-medium text-shodo-ink">Appearance</p>
              <p className="text-xs text-shodo-ink/50 mt-0.5">
                Light or dark theme for this device. System follows your OS setting.
              </p>
            </div>
            <fieldset className="ml-4 shrink-0 flex rounded-md border border-shodo-ink/20 overflow-hidden">
              <legend className="sr-only">Appearance</legend>
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={theme === opt.value}
                  onClick={() => {
                    setTheme(opt.value);
                    saveTheme(opt.value);
                  }}
                  className={`px-3 py-1.5 text-sm transition-colors ${
                    theme === opt.value
                      ? "bg-shodo-ink text-shodo-paper"
                      : "text-shodo-ink-light hover:bg-shodo-ink/5"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </fieldset>
          </div>

          {/* JLPT Level */}
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-sm font-medium text-shodo-ink">Current JLPT Level</p>
              <p className="text-xs text-shodo-ink/50 mt-0.5">
                Used as the default difficulty when generating scenarios
              </p>
            </div>
            <select
              value={jlptLevel}
              onChange={(e) => handleJlptLevel(e.target.value)}
              className="ml-4 shrink-0 text-sm border border-shodo-ink/20 rounded-md px-2 py-1.5 bg-shodo-paper text-shodo-ink focus:outline-none focus:ring-2 focus:ring-shodo-accent"
            >
              <option value="">Not set</option>
              {JLPT_LEVELS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>

          {/* Preferred user role */}
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-sm font-medium text-shodo-ink">Default Scenario Role</p>
              <p className="text-xs text-shodo-ink/50 mt-0.5">
                Your default persona in generated roleplay scenarios
              </p>
            </div>
            <select
              value={preferredUserRole}
              onChange={(e) => handlePreferredUserRole(e.target.value)}
              className="ml-4 shrink-0 text-sm border border-shodo-ink/20 rounded-md px-2 py-1.5 bg-shodo-paper text-shodo-ink focus:outline-none focus:ring-2 focus:ring-shodo-accent"
            >
              <option value="">Not set (AI chooses)</option>
              {userRoles.filter((r) => /^[\x20-\x7E]+$/.test(r)).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        </div>
      </section>
    </main>
  );
}
