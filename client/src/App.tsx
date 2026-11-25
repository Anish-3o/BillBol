import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { PwaStatus } from './components/PwaStatus';
import { PageLoader, RequireAuth, RequireGuest, RequireOwner } from './components/RouteGuards';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

// Code splitting: the landing, login and register pages ship in the first download, because
// that is what a visitor sees first. Everything behind login (and the app shell with the Ramu
// assistant) is a separate file fetched when first needed, so the first screen loads faster on
// a budget phone over 4G. The service worker precaches these files too, so they still open
// offline and instantly after the first visit.
const AppLayout = lazy(() => import('./components/AppLayout').then((m) => ({ default: m.AppLayout })));
const BillDetailPage = lazy(() => import('./pages/BillDetailPage'));
const BillsPage = lazy(() => import('./pages/BillsPage'));
const CustomerDetailPage = lazy(() => import('./pages/CustomerDetailPage'));
const CustomersPage = lazy(() => import('./pages/CustomersPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const NewBillPage = lazy(() => import('./pages/NewBillPage'));
const PriceUpdatePage = lazy(() => import('./pages/PriceUpdatePage'));
const ProductFormPage = lazy(() => import('./pages/ProductFormPage'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const ReceiveStockPage = lazy(() => import('./pages/ReceiveStockPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

export default function App() {
  return (
    <>
      <PwaStatus />
      {/* While the app shell itself is loading. Pages inside it have their own, smaller
          fallback in AppLayout, so the menu stays on screen while a page loads. */}
      <Suspense fallback={<PageLoader />}>
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
      </Suspense>
    </>
  );
}
