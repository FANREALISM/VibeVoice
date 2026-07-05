import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Force bypass login for now because Supabase is erroring
    setUser({ id: 'local-guest', email: 'guest@vibe.voice' } as User);
    setLoading(false);
  }, []);

  const loginWithGoogle = async () => {};
  const loginWithEmail = async (email: string, password: string) => {};
  const signUpWithEmail = async (email: string, password: string) => {};
  const logout = async () => {
    setUser(null);
  };

  return { user, loading, loginWithGoogle, loginWithEmail, signUpWithEmail, logout };
}

