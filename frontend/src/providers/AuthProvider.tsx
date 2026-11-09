"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signOut as firebaseSignOut,
  User,
} from "firebase/auth";
import { usePathname, useRouter } from "next/navigation";
import { auth } from "@/lib/firebase-client";
import { apiFetch } from "@/lib/api-client";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  /**
   * true: a level has been chosen. false: not yet, so only /profile renders and everything else
   * redirects there (the API refuses too). null: unknown (signed out, or /users/me failed), so the
   * app isn't held back on the frontend; the API still enforces the gate.
   */
  profileComplete: boolean | null;
  /** Called by /profile once the level is saved, so the app opens without a reload. */
  markProfileComplete: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAdmin: false,
  profileComplete: null,
  markProfileComplete: () => {},
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const DEV_SKIP_AUTH = process.env.NEXT_PUBLIC_DEV_SKIP_AUTH === "true";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profileComplete, setProfileComplete] = useState<boolean | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Subscribe to Firebase auth state once on mount.
  useEffect(() => {
    // Dev bypass: skip Firebase entirely. The backend guard falls back to
    // user_default when no Authorization header is present.
    if (DEV_SKIP_AUTH) {
      const devUid = process.env.NEXT_PUBLIC_DEV_USER_ID ?? "user_default";
      console.warn(`[AuthProvider] DEV_SKIP_AUTH is enabled — bypassing Firebase auth. uid: ${devUid}`);
      setUser({ uid: devUid, email: `${devUid} (dev)` } as User);
      setIsAdmin(true);
      setProfileComplete(true); // the backend's dev bypass skips the profile gate too
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        // Idempotent — creates the UserRoot doc on first login, no-ops thereafter. Read it before
        // setting the user, so the redirect never runs with this user but an old or default flag.
        let admin = false;
        let complete: boolean | null = null; // unknown if /users/me fails
        try {
          const res = await apiFetch("/api/users/me");
          if (res.ok) {
            const data = await res.json();
            admin = data.isAdmin ?? false;
            complete = data.profileComplete === true;
          }
        } catch (e) {
          console.error("[AuthProvider] Failed to initialize user doc:", e);
        }
        setIsAdmin(admin);
        setProfileComplete(complete);
        setUser(currentUser);
      } else {
        setUser(null);
        setIsAdmin(false);
        setProfileComplete(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Redirect logic — runs whenever auth state or location changes.
  useEffect(() => {
    if (loading || DEV_SKIP_AUTH) return;

    const isPublic = pathname === "/login" || pathname === "/auth/callback";
    if (!user && !isPublic) {
      router.push("/login");
    } else if (user && isPublic) {
      // Same sign-in link for everyone; an incomplete profile (no level chosen) goes to /profile.
      router.push(profileComplete === false ? "/profile" : "/");
    } else if (user && profileComplete === false && pathname !== "/profile") {
      router.push("/profile");
    }
  }, [user, loading, profileComplete, pathname, router]);

  const signOut = async () => {
    await firebaseSignOut(auth);
    // The onAuthStateChanged listener will fire, set user to null,
    // and the redirect effect above will push to /login.
  };

  // What to render:
  // • Loading  → spinner
  // • No user, not on /login → null (redirect is in-flight, avoid flash)
  // • No user, on /login  → login page
  // • User authenticated   → full app, except: an incomplete profile renders only /profile
  //   (other pages would mount and fire requests the API refuses; the redirect is in flight)
  const isPublic = pathname === "/login" || pathname === "/auth/callback";
  const heldAtProfile = !!user && profileComplete === false && pathname !== "/profile" && !isPublic;
  const shouldRender = !loading && (!!user || isPublic) && !heldAtProfile;

  return (
    <AuthContext.Provider value={{ user, loading, isAdmin, profileComplete, markProfileComplete: () => setProfileComplete(true), signOut }}>
      {loading ? (
        <div className="flex h-screen w-full items-center justify-center bg-shodo-paper text-shodo-ink">
          <p className="animate-pulse">Loading...</p>
        </div>
      ) : shouldRender ? (
        children
      ) : null}
    </AuthContext.Provider>
  );
}
