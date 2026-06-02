import { FormEvent, useState } from 'react';
import { useAuth } from '../context/AuthContext';

export function AuthPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      if (mode === 'login') {
        await signIn(username, password);
      } else {
        await signUp(username, password);
        setMessage('Account created. You can now use the board. If you are not logged in automatically, disable email confirmation in Supabase Auth settings and log in again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-copy">
          <span className="brand-mark big">🏆</span>
          <p className="eyebrow">World Cup 2026 Prediction Board</p>
          <h1>Build your match-day pool with a clean $100 wallet.</h1>
          <p>
            Login with a username and password. Supabase Auth is used privately behind the scenes so row-level security can protect balances and bids.
          </p>
        </div>

        <form className="auth-card" onSubmit={handleSubmit}>
          <h2>{mode === 'login' ? 'Login' : 'Create account'}</h2>

          <label className="field-label">
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="anoop"
              autoComplete="username"
            />
          </label>

          <label className="field-label">
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>

          {error && <p className="error-text">{error}</p>}
          {message && <p className="success-text">{message}</p>}

          <button className="primary-button full-width" disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Login' : 'Create account'}
          </button>

          <button
            type="button"
            className="link-button"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login');
              setError(null);
              setMessage(null);
            }}
          >
            {mode === 'login' ? 'Need a new user? Create one' : 'Already have a user? Login'}
          </button>
        </form>
      </section>
    </main>
  );
}
