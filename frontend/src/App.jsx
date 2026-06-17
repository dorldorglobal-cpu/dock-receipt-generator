import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useState } from "react";
import Login from "./components/Login";
import Layout from "./components/Layout";

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
  const [authed, setAuthed] = useState(!!localStorage.getItem("ddg_auth"));
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
            element={<OrderDetails />}
          />

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

          <Route path="/towing-charges"    element={<TowingCharges />} />
          <Route path="/ocean-freight"     element={<OceanFreight />} />
          <Route path="/vessel-schedule"   element={<VesselSchedule />} />
          <Route path="/ai"               element={<AiAssistant />} />

        </Routes>
      </Layout>
    </BrowserRouter>
  );
}