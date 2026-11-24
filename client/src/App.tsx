import { Navigate, Route, Routes } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { RequireAuth, RequireGuest, RequireOwner } from './components/RouteGuards';
import BillDetailPage from './pages/BillDetailPage';
import BillsPage from './pages/BillsPage';
import CustomerDetailPage from './pages/CustomerDetailPage';
import CustomersPage from './pages/CustomersPage';
import DashboardPage from './pages/DashboardPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import NewBillPage from './pages/NewBillPage';
import PriceUpdatePage from './pages/PriceUpdatePage';
import ProductFormPage from './pages/ProductFormPage';
import ProductsPage from './pages/ProductsPage';
import ReceiveStockPage from './pages/ReceiveStockPage';
import RegisterPage from './pages/RegisterPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />

      {/* Only for logged-out users; logged-in users are sent to the dashboard. */}
      <Route element={<RequireGuest />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      {/* Needs login. Every page in here shares the navigation and the "Hey Ramu" assistant. */}
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          {/* Owners and staff both make bills and keep the khata. */}
          <Route path="/bills/new" element={<NewBillPage />} />
          <Route path="/bills" element={<BillsPage />} />
          <Route path="/bills/:id" element={<BillDetailPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />
          <Route path="/products" element={<ProductsPage />} />
          {/* Receiving a delivery is counter work, so staff can do it too. */}
          <Route path="/stock/receive" element={<ReceiveStockPage />} />
          {/* Changing the catalogue is owner-only (the API enforces this too). */}
          <Route element={<RequireOwner fallback="/products" />}>
            <Route path="/products/new" element={<ProductFormPage />} />
            <Route path="/products/:id/edit" element={<ProductFormPage />} />
            <Route path="/products/prices" element={<PriceUpdatePage />} />
          </Route>
          <Route element={<RequireOwner fallback="/dashboard" />}>
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
