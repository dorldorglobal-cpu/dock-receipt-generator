import { BrowserRouter, Routes, Route, useParams } from "react-router-dom";
import { useState } from "react";
import Login from "./components/Login";
import Layout from "./components/Layout";
import { isLoggedIn } from "./lib/auth";

import DockReceiptPage from "./pages/DockReceiptPage";

import Dashboard from "./pages/Dashboard";

import Orders from "./pages/Orders";
import Containers from "./pages/Containers";

import CreateOrder from "./pages/CreateOrder";

import OrderDetails from "./pages/OrderDetails";

import TowingCharges from "./pages/TowingCharges";
import OceanFreight from "./pages/OceanFreight";
import Customers from "./pages/Customers";
import Expenses  from "./pages/Expenses";
import Vendors   from "./pages/Vendors";
import Reports   from "./pages/Reports";
import Invoices  from "./pages/Invoices";
import VesselSchedule from "./pages/VesselSchedule";
import AiAssistant from "./pages/AiAssistant";
import BlSeparator from "./pages/BlSeparator";
import EmailOrders from "./pages/EmailOrders";
import SignDocuments from "./pages/SignDocuments";
import AesSettings from "./pages/AesSettings";
import AesFiling from "./pages/AesFiling";
import ToInvoice from "./pages/ToInvoice";
import Releases from "./pages/Releases";

// Order page starts fresh for each order — moving straight from one order to the
// next (To Invoice "next car") reloads everything instead of reusing the last one's data
function OrderDetailsKeyed() {
  const { id } = useParams();
  return <OrderDetails key={id} />;
}

import "./App.css";

function ComingSoon({ title }) {
  return (
    <div>
      <h1>{title}</h1>

      <p>This section is coming next.</p>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(isLoggedIn());
  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route
            path="/"
            element={<Dashboard />}
          />

          <Route
            path="/dock-receipt"
            element={<DockReceiptPage />}
          />

          <Route
            path="/orders"
            element={<Orders />}
          />

          <Route
            path="/orders/new"
            element={<CreateOrder />}
          />

          <Route
            path="/orders/:id"
            element={<OrderDetailsKeyed />}
          />
          <Route path="/to-invoice" element={<ToInvoice />} />
          <Route path="/releases" element={<Releases />} />

          <Route path="/orders/:id/aes" element={<AesFiling />} />

          <Route path="/email-orders" element={<EmailOrders />} />
          <Route path="/containers" element={<Containers />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/expenses"  element={<Expenses />} />
          <Route path="/vendors"   element={<Vendors />} />
          <Route path="/reports"   element={<Reports />} />

          <Route
            path="/shipments"
            element={<BlSeparator />}
          />

          <Route path="/invoices" element={<Invoices />} />

          <Route path="/sign-documents" element={<SignDocuments />} />

          <Route
            path="/uploads"
            element={
              <ComingSoon title="Uploads" />
            }
          />

          <Route
            path="/settings"
            element={
              <ComingSoon title="Settings" />
            }
          />

          <Route path="/settings/aes" element={<AesSettings />} />

          <Route path="/towing-charges"    element={<TowingCharges />} />
          <Route path="/ocean-freight"     element={<OceanFreight />} />
          <Route path="/vessel-schedule"   element={<VesselSchedule />} />
          <Route path="/ai"               element={<AiAssistant />} />

        </Routes>
      </Layout>
    </BrowserRouter>
  );
}