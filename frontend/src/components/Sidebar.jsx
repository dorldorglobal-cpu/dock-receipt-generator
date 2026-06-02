import { NavLink } from "react-router-dom";
import "./Sidebar.css";
import logo from "../logo.png";

// ─── Icon Components ────────────────────────────────────────────────────────

const Icon = ({ path, size = 18 }) => (
  <svg className="nav-icon" width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={path} />
  </svg>
);

const icons = {
  dashboard: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10",
  orders: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2 M9 5a2 2 0 002 2h2a2 2 0 002-2 M9 5a2 2 0 012-2h2a2 2 0 012 2 M12 12h.01 M12 16h.01",
  createOrder: "M12 5v14 M5 12h14",
  dockReceipt: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  towing: "M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0",
  ocean: "M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",
  customers: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2 M9 11a4 4 0 100-8 4 4 0 000 8z M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75",
  shipments: "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.63A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.91a16 16 0 006.72 6.72l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z",
  invoices: "M9 7H6a2 2 0 00-2 2v9a2 2 0 002 2h9a2 2 0 002-2v-3 M9 10h.01 M9 13h.01 M9 16h.01 M13 7l5 5 M18 7h-5v5",
  expenses: "M2 8h20v13a1 1 0 01-1 1H3a1 1 0 01-1-1V8z M2 8l2-5h16l2 5 M12 12v4 M10 14h4",
  vendors:  "M3 3h18v4H3z M5 7v14h14V7 M9 11h6 M9 15h6",
  reports:  "M18 20V10 M12 20V4 M6 20v-6",
  schedule: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z",
  ai: "M12 2a2 2 0 012 2c0 .74-.4 1.38-1 1.72V7h1a7 7 0 017 7h1a1 1 0 010 2h-1v1a2 2 0 01-2 2v1a1 1 0 01-2 0v-1H7v1a1 1 0 01-2 0v-1a2 2 0 01-2-2v-1H2a1 1 0 010-2h1a7 7 0 017-7h1V5.72A2 2 0 0110 4a2 2 0 012-2z M9 14a1 1 0 100-2 1 1 0 000 2z M15 14a1 1 0 100-2 1 1 0 000 2z",
};

function NavItem({ to, iconKey, label, end = false }) {
  return (
    <NavLink to={to} end={end}>
      <Icon path={icons[iconKey]} />
      <span className="nav-label">{label}</span>
    </NavLink>
  );
}

export default function Sidebar() {
  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <img src={logo} alt="DDG" />
        <div className="sidebar-logo-text">
          <span className="sidebar-logo-name">DDG OPS</span>
          <span className="sidebar-logo-sub">Operations Platform</span>
        </div>
      </div>

      {/* Main */}
      <div className="sidebar-section-label">Main</div>
      <nav className="sidebar-nav">
        <NavItem to="/" iconKey="dashboard" label="Dashboard" end />
      </nav>

      {/* Orders */}
      <div className="sidebar-section-label">Orders</div>
      <nav className="sidebar-nav">
        <NavItem to="/orders"      iconKey="orders"      label="All Orders" />
        <NavItem to="/orders/new"  iconKey="createOrder" label="New Order" />
        <NavItem to="/customers"   iconKey="customers"   label="Customers" />
      </nav>

      {/* Operations */}
      <div className="sidebar-section-label">Operations</div>
      <nav className="sidebar-nav">
        <NavItem to="/dock-receipt"    iconKey="dockReceipt" label="Dock Receipt" />
        <NavItem to="/towing-charges"  iconKey="towing"      label="Towing Charges" />
        <NavItem to="/ocean-freight"   iconKey="ocean"       label="Ocean Freight" />
        <NavItem to="/vessel-schedule"  iconKey="schedule"    label="Vessel Schedule" />
        <NavItem to="/shipments"       iconKey="shipments"   label="Shipments" />
      </nav>

      {/* Finance */}
      <div className="sidebar-section-label">Finance</div>
      <nav className="sidebar-nav">
        <NavItem to="/invoices"  iconKey="invoices"  label="Invoices" />
        <NavItem to="/expenses"  iconKey="expenses"  label="Expenses" />
        <NavItem to="/vendors"   iconKey="vendors"   label="Vendors" />
        <NavItem to="/reports"   iconKey="reports"   label="Reports" />
      </nav>

      {/* AI */}
      <div className="sidebar-section-label">Intelligence</div>
      <nav className="sidebar-nav">
        <NavItem to="/ai" iconKey="ai" label="AI Assistant" />
      </nav>

      {/* Settings */}
      <div className="sidebar-section-label">System</div>
      <nav className="sidebar-nav">
        <NavItem to="/settings" iconKey="settings" label="Settings" />
      </nav>

      <div className="sidebar-spacer" />

      <div className="sidebar-footer">
        <span className="status-dot" />
        <span>System online</span>
      </div>
    </aside>
  );
}
