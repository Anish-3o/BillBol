import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { apiGet } from '../api/client';
import { useAuth } from '../hooks/useAuth';

type Health = { status: string; db: string };

// The original landing page, now with links into the app.
export default function HomePage() {
  const { status } = useAuth();
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    apiGet<Health>('/health')
      .then(setHealth)
      .catch(() => setError(true));
  }, []);

  return (
    <main className="home">
      <div className="logo">🧾</div>
      <h1>BillBol</h1>
      <p className="tagline">Bolo, aur bill taiyaar.</p>
      <p className="sub">Just speak. The bill is ready.</p>

      <div className="home-actions">
        {status === 'authenticated' ? (
          <Link to="/dashboard" className="btn btn-primary">
            Open dashboard
          </Link>
        ) : (
          <>
            <Link to="/register" className="btn btn-primary">
              Create your shop
            </Link>
            <Link to="/login" className="btn btn-secondary">
              Log in
            </Link>
          </>
        )}
      </div>

      <div className="status">
        <span>
          API: {error ? '🔴 not reachable' : health ? '🟢 running' : '⏳ checking...'}
        </span>
        {health && (
          <span>Database: {health.db === 'connected' ? '🟢 connected' : '🔴 disconnected'}</span>
        )}
      </div>
    </main>
  );
}
