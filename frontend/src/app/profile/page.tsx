"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
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
  const { user, profileComplete, markProfileComplete } = useAuth();
  const router = useRouter();
  // The profile was incomplete when this page opened: show the banner and, once a level is
  // saved, the Continue button (it stays for the visit, even after markProfileComplete).
  const [completing] = useState(profileComplete === false);
  const [showFurigana, setShowFurigana] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>("system");
  // Required. "" = never chosen (the backend treats that as N5); shown as a placeholder to pick from.
  const [jlptLevel, setJlptLevel] = useState<string>("");
  const [preferredUserRole, setPreferredUserRole] = useState<string>("");
  const [audioFirst, setAudioFirst] = useState(false);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  // Save feedback for the setting last changed, shown in that setting's row.
  const [saveStatus, setSaveStatus] = useState<{ field: string; state: "saving" | "saved" | "error" } | null>(null);

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

  /**
   * Saves one preference; true if the server accepted it (apiFetch doesn't throw on HTTP errors).
   * The patch's key names the setting, so its row shows the Saving / Saved / Couldn't save status.
   */
  const patchPreferences = useCallback(async (patch: Record<string, unknown>): Promise<boolean> => {
    const field = Object.keys(patch)[0];
    setSaveStatus({ field, state: "saving" });
    let ok = false;
    try {
      const res = await apiFetch("/api/users/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      ok = res.ok;
    } catch {
      ok = false;
    }
    setSaveStatus({ field, state: ok ? "saved" : "error" });
    if (ok) setTimeout(() => setSaveStatus(s => (s?.field === field && s.state === "saved" ? null : s)), 2000);
    return ok;
  }, []);

  /** A setting's control, with its save status to the left (shown when it was the last one changed). */
  const withStatus = (field: string, control: React.ReactNode) => (
    <div className="flex items-center gap-3 ml-4 shrink-0">
      {statusFor(field)}
      {control}
    </div>
  );

  /** The save status for one setting's row (nothing unless that setting was the last one changed). */
  const statusFor = (field: string) => {
    if (saveStatus?.field !== field) return null;
    if (saveStatus.state === "saving") return <span className="text-xs text-shodo-ink/40">Saving…</span>;
    if (saveStatus.state === "error") return <span className="text-xs text-shodo-stamp-red">Couldn't save</span>;
    return <span className="text-xs text-green-600">Saved</span>;
  };

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
    const previous = jlptLevel;
    setJlptLevel(val);
    if (await patchPreferences({ jlptLevel: val })) markProfileComplete();
    else setJlptLevel(previous);
  }, [jlptLevel, patchPreferences, markProfileComplete]);

  const handlePreferredUserRole = useCallback(async (val: string) => {
    setPreferredUserRole(val);
    await patchPreferences({ preferredUserRole: val || null });
  }, [patchPreferences]);

  if (!user?.email) return null;

  return (
    <main className="container mx-auto max-w-2xl px-8 py-12">
      <h1 className="text-2xl font-bold text-shodo-ink mb-10">Profile</h1>

      {completing && (
        <div className="mb-10 rounded-lg border border-shodo-ink/15 bg-shodo-paper-warm px-5 py-4">
          <p className="font-medium text-shodo-ink">Complete your profile</p>
          {profileComplete === true ? (
            <div className="mt-2 flex items-center justify-between gap-4">
              <p className="text-sm text-shodo-ink/70">You're all set. You can change any of these later.</p>
              <button
                onClick={() => router.push("/")}
                className="shrink-0 rounded-lg bg-shodo-ink px-4 py-2 text-sm font-medium text-shodo-paper hover:bg-shodo-ink/80"
              >
                Continue to AIGENKI →
              </button>
            </div>
          ) : (
            <p className="mt-1 text-sm text-shodo-ink/70">
              Choose your JLPT level below to start. It sets the level of your lessons, questions and scenarios.
            </p>
          )}
        </div>
      )}

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
            {withStatus("showFurigana", (
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
            ))}
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
            {withStatus("audioFirstExperiment", (
            <button
              type="button"
              onClick={handleToggleAudioFirst}
              role="switch"
              aria-checked={audioFirst}
              aria-label="Audio-first vocab (experimental)"
              className={`relative shrink-0 w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-shodo-accent focus:ring-offset-2 ${
                audioFirst ? "bg-shodo-ink" : "bg-shodo-ink/20"
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-shodo-paper shadow-sm transition-all duration-200 ${
                  audioFirst ? "left-5" : "left-0.5"
                }`}
              />
            </button>
            ))}
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
                Sets the level of your lessons, questions and scenarios
              </p>
            </div>
            {withStatus("jlptLevel", (
            <select
              value={jlptLevel}
              onChange={(e) => handleJlptLevel(e.target.value)}
              disabled={saveStatus?.field === "jlptLevel" && saveStatus.state === "saving"}
              className="shrink-0 disabled:opacity-50 text-sm border border-shodo-ink/20 rounded-md px-2 py-1.5 bg-shodo-paper text-shodo-ink focus:outline-none focus:ring-2 focus:ring-shodo-accent"
            >
              {jlptLevel === "" && (
                <option value="" disabled>Choose your level</option>
              )}
              {JLPT_LEVELS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
            ))}
          </div>

          {/* Preferred user role */}
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <p className="text-sm font-medium text-shodo-ink">Default Scenario Role</p>
              <p className="text-xs text-shodo-ink/50 mt-0.5">
                Your default persona in generated roleplay scenarios
              </p>
            </div>
            {withStatus("preferredUserRole", (
            <select
              value={preferredUserRole}
              onChange={(e) => handlePreferredUserRole(e.target.value)}
              className="shrink-0 text-sm border border-shodo-ink/20 rounded-md px-2 py-1.5 bg-shodo-paper text-shodo-ink focus:outline-none focus:ring-2 focus:ring-shodo-accent"
            >
              <option value="">Not set (AI chooses)</option>
              {userRoles.filter((r) => /^[\x20-\x7E]+$/.test(r)).map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
