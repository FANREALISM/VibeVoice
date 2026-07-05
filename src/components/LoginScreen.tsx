import React, { useState } from 'react';
import { LogIn, Music, Mail, KeyRound, AlertCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export const LoginScreen: React.FC = () => {
  const { loginWithGoogle, loginWithEmail, signUpWithEmail, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErrorMsg('Please enter both email and password.');
      return;
    }
    setErrorMsg('');
    setIsSubmitting(true);
    try {
      if (isSignUp) {
        await signUpWithEmail(email, password);
        setErrorMsg('Please check your email for a confirmation link.');
      } else {
        await loginWithEmail(email, password);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred during authentication.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      await loginWithGoogle();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to login with Google. Check if the provider is enabled in Supabase.');
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-daw-bg text-white px-4">
      <div className="w-full max-w-md space-y-8 bg-daw-surface p-10 rounded-2xl border border-zinc-800/80 shadow-2xl relative overflow-hidden group">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-daw-accent to-cyan-500 rounded-2xl opacity-10 blur group-hover:opacity-20 transition duration-1000"></div>
        
        <div className="relative space-y-6">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="p-4 bg-daw-accent/10 rounded-full border border-daw-accent/20 animate-pulse">
              <Music className="w-10 h-10 text-daw-accent" />
            </div>
            <div className="space-y-1">
              <h1 className="text-3xl font-black tracking-tighter uppercase">
                VIBE<span className="text-daw-accent">VOICE</span>
              </h1>
              <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest">
                System Login
              </p>
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded flex items-start gap-2 text-red-400 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Email Data</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input 
                    type="email" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-black/50 border border-zinc-800 rounded pl-9 pr-3 py-2 text-sm text-[#06b6d4] outline-none ring-1 ring-zinc-800 focus:ring-[#06b6d4]/50"
                    placeholder="user@network.com"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-zinc-500 uppercase block mb-1">Access Key</label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input 
                    type="password" 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-black/50 border border-zinc-800 rounded pl-9 pr-3 py-2 text-sm text-[#06b6d4] outline-none ring-1 ring-zinc-800 focus:ring-[#06b6d4]/50"
                    placeholder="••••••••"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || isSubmitting}
              className="w-full py-2 bg-daw-accent/10 border border-daw-accent/30 text-daw-accent text-xs font-bold rounded uppercase hover:bg-daw-accent/20 transition-all shadow-[0_0_15px_rgba(6,182,212,0.15)] disabled:opacity-50"
            >
              {isSubmitting ? 'Authenticating...' : isSignUp ? 'Initialize Profile' : 'Initialize Session'}
            </button>
          </form>

          <div className="text-center">
            <button 
              onClick={() => { setIsSignUp(!isSignUp); setErrorMsg(''); }}
              className="text-[10px] text-zinc-500 hover:text-white uppercase tracking-widest transition-colors"
            >
              {isSignUp ? 'Switch to Session Init' : 'Switch to Profile Init'}
            </button>
          </div>

          <div className="relative flex items-center justify-center border-t border-zinc-800 pt-4">
             <button
              onClick={handleGoogleLogin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 bg-zinc-900 border border-zinc-700 text-zinc-300 font-bold text-xs py-3 rounded-lg hover:bg-zinc-800 transition-all active:scale-95 disabled:opacity-50 uppercase tracking-wider"
            >
              <LogIn className="w-4 h-4" />
              Google Provider
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
