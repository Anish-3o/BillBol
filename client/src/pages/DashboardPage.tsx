import { Link } from 'react-router';
import { useSession } from '../hooks/useAuth';

export default function DashboardPage() {
  const { user, tenant } = useSession();

  return (
    <main className="page">
      <section className="welcome-card">
        <p className="welcome-eyebrow">{tenant.name}</p>
        <h1 className="welcome-title">Namaste, {user.name} 🙏</h1>
        <p className="welcome-sub">Ready for customers. Start a bill or manage your products.</p>
        <div className="button-row">
          <Link to="/bills/new" className="btn btn-light">
            New bill
          </Link>
          <Link to="/products" className="btn btn-outline-light">
            Products
          </Link>
        </div>
      </section>

      <section className="info-card" aria-labelledby="shop-details">
        <h2 id="shop-details">Shop details</h2>
        <dl className="details">
          <div>
            <dt>Owner</dt>
            <dd>{tenant.ownerName}</dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>{tenant.phone}</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{tenant.state}</dd>
          </div>
          <div>
            <dt>GSTIN</dt>
            <dd>{tenant.gstin ?? 'Not registered'}</dd>
          </div>
          <div>
            <dt>Your role</dt>
            <dd className="role">{user.role}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
