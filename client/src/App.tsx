import { Navigate, Route, Routes } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { RequireAuth, RequireGuest, RequireOwner } from './components/RouteGuards';
import BillDetailPage from './pages/BillDetailPage';
import BillsPage from './pages/BillsPage';
import DashboardPage from './pages/DashboardPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import NewBillPage from './pages/NewBillPage';
import ProductFormPage from './pages/ProductFormPage';
import ProductsPage from './pages/ProductsPage';
import RegisterPage from './pages/RegisterPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />

      {/* Only for logged-out users; logged-in users are sent to the dashboard. */}
      <Route element={<RequireGuest />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      {/* Needs login. Every page in here shares the top bar and navigation. */}
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          {/* Owners and staff both make bills. */}
          <Route path="/bills/new" element={<NewBillPage />} />
          <Route path="/bills" element={<BillsPage />} />
          <Route path="/bills/:id" element={<BillDetailPage />} />
          <Route path="/products" element={<ProductsPage />} />
          {/* Changing the catalogue is owner-only (the API enforces this too). */}
          <Route element={<RequireOwner fallback="/products" />}>
            <Route path="/products/new" element={<ProductFormPage />} />
            <Route path="/products/:id/edit" element={<ProductFormPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
