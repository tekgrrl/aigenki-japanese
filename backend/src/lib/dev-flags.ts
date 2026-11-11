/**
 * A dev-only switch from backend/.env (e.g. ADMIN_ALL, DEV_AUTH_BYPASS). On only when the flag is
 * 'true' AND NODE_ENV is exactly 'development', so a deploy that forgets NODE_ENV stays safe.
 */
export const devFlag = (name: string): boolean =>
  process.env.NODE_ENV === 'development' && process.env[name] === 'true';
