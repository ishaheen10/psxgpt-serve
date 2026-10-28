import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

// Supabase client (inline)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!supabaseUrl) console.warn('VITE_SUPABASE_URL not defined');
if (!supabaseAnonKey) console.warn('VITE_SUPABASE_ANON_KEY not defined');

const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

// Hook-free access token getter for one-shot calls (e.g. an action handler that
// must not subscribe to auth state). Reuses the singleton client.
export async function getAccessToken(): Promise<string> {
  if (!supabase) return '';
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || '';
  } catch {
    return '';
  }
}

export interface AuthState {
  user: any;
  isLoading: boolean;
  isAnonymous: boolean;
  betaAccessGranted: boolean;
  hasActiveSubscription: boolean;
}

export function useAuth() {
  const client = supabase;
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!client) { setUser(null); setIsLoading(false); return; }

    let mounted = true;

    const initSession = async () => {
      const { data, error } = await client.auth.getSession();
      if (!mounted) return;
      if (error) console.warn('[Auth] Failed to fetch session', error);

      // Only accept non-anonymous users
      const sessionUser = data.session?.user;
      if (sessionUser && !sessionUser.is_anonymous) {
        setUser(sessionUser);
      } else {
        setUser(null);
      }
      setIsLoading(false);
    };

    void initSession();

    const { data: subscription } = client.auth.onAuthStateChange(async (_, nextSession) => {
      if (!mounted) return;
      const nextUser = nextSession?.user;
      // Only accept non-anonymous users
      if (nextUser && !nextUser.is_anonymous) {
        setUser(nextUser);
      } else {
        setUser(null);
      }
    });

    return () => { mounted = false; subscription?.subscription?.unsubscribe(); };
  }, [client]);

  const getToken = useCallback(async (): Promise<string> => {
    if (!client) return '';
    const { data } = await client.auth.getSession();
    return data.session?.access_token || '';
  }, [client]);

  const signInWithGoogle = useCallback(() => client?.auth.signInWithOAuth({
    provider: 'google',
    // Return to THIS origin after OAuth instead of falling back to Supabase's
    // Site URL (prod). Origin must be in Supabase's allowed Redirect URLs.
    options: { redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined },
  }), [client]);

  const sendMagicLink = useCallback(async (email: string) => {
    if (!client) throw new Error('Supabase client unavailable');
    if (!email) throw new Error('Email required');
    const emailRedirectTo = typeof window !== 'undefined' ? window.location.origin : undefined;
    const { error } = await client.auth.signInWithOtp({ email, options: emailRedirectTo ? { emailRedirectTo } : undefined });
    if (error) throw error;
  }, [client]);

  const signOut = useCallback(() => client?.auth.signOut(), [client]);

  const authState = useMemo((): AuthState => {
    const appMetadata = (user?.app_metadata ?? {}) as Record<string, unknown>;
    const betaAccessRaw = appMetadata?.beta_access;
    const subscriptionStatus = typeof appMetadata.stripe_subscription_status === 'string' ? appMetadata.stripe_subscription_status : '';

    return {
      user,
      isLoading,
      isAnonymous: Boolean(user?.is_anonymous),
      betaAccessGranted: betaAccessRaw === true || betaAccessRaw === 'true',
      hasActiveSubscription: subscriptionStatus === 'active' || subscriptionStatus === 'trialing',
    };
  }, [user, isLoading]);

  return { ...authState, getToken, signInWithGoogle, sendMagicLink, signOut };
}
