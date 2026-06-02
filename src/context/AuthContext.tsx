import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { isValidUsername, normalizeUsername, usernameToPrivateEmail } from '../lib/auth';
import type { Profile } from '../types';

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (activeSession: Session | null) => {
    const userId = activeSession?.user.id;

    if (!userId) {
      setProfile(null);
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, role, balance, created_at, updated_at')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Failed to load profile:', error);
      setProfile(null);
      return;
    }

    if (!data) {
      console.error('No profile row found for this auth user. Check the on_auth_user_created trigger in Supabase.');
      setProfile(null);
      return;
    }

    setProfile(data as Profile);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function initialise() {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;

      if (error) console.error('Failed to get session:', error);
      setSession(data.session);
      await loadProfile(data.session);
      if (mounted) setLoading(false);
    }

    initialise();

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      loadProfile(nextSession);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (username: string, password: string) => {
    const cleaned = normalizeUsername(username);
    if (!isValidUsername(cleaned)) {
      throw new Error('Use 3-24 characters: letters, numbers, dot, underscore or hyphen.');
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: usernameToPrivateEmail(cleaned),
      password,
    });

    if (error) throw error;
  }, []);

  const signUp = useCallback(async (username: string, password: string) => {
    const cleaned = normalizeUsername(username);
    if (!isValidUsername(cleaned)) {
      throw new Error('Use 3-24 characters: letters, numbers, dot, underscore or hyphen.');
    }

    const { error } = await supabase.auth.signUp({
      email: usernameToPrivateEmail(cleaned),
      password,
      options: {
        data: {
          username: cleaned,
        },
      },
    });

    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    profile,
    loading,
    refreshProfile: () => loadProfile(session),
    signIn,
    signUp,
    signOut,
  }), [session, profile, loading, loadProfile, signIn, signUp, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
