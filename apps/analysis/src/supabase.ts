import type { Env } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Auth Only - All message storage moved to DO SQLite
// ─────────────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email?: string;
}

export async function getUser(env: Env, authHeader?: string): Promise<User | null> {
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.slice(7);

  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });

  if (!res.ok) {
    return null;
  }
  const data = (await res.json()) as { id?: string; email?: string; is_anonymous?: boolean };
  if (data.is_anonymous) return null;
  return data.id ? { id: data.id, email: data.email } : null;
}
