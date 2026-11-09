import { auth } from "./firebase-client";

/**
 * A wrapper around the native browser `fetch` API.
 * It automatically looks up the current Firebase Auth user's token and
 * injects it into the Authorization header of the request.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);

  // Dev bypass: send no token so the backend guard uses X-Dev-User-Id or
  // falls back to user_default.
  if (process.env.NEXT_PUBLIC_DEV_SKIP_AUTH === "true") {
    const devUid = process.env.NEXT_PUBLIC_DEV_USER_ID;
    if (devUid) headers.set("X-Dev-User-Id", devUid);
  } else {
    // Ensure Firebase has checked IndexedDB/LocalStorage for a session
    await auth.authStateReady();

    // If we have a user, attempt to get their active token
    if (auth.currentUser) {
      try {
        const token = await auth.currentUser.getIdToken();
        headers.set("Authorization", `Bearer ${token}`);
        console.log(`[apiFetch] Injected token for ${input}`);
      } catch (error) {
        console.error(`[apiFetch] Failed to get Firebase token for ${input}:`, error);
      }
    } else {
      console.warn(`[apiFetch] No currentUser available for ${input}`);
    }
  }

  const res = await fetch(input, {
    ...init,
    headers,
  });
  // Safety net for the profile gate: the API refuses everything but the profile until a level is
  // chosen. AuthProvider normally redirects first; if a request slips through, go to /profile.
  if (res.status === 403 && typeof window !== "undefined" && window.location.pathname !== "/profile") {
    const body = await res.clone().json().catch(() => null);
    if (body?.code === "PROFILE_INCOMPLETE") window.location.assign("/profile");
  }
  return res;
}
