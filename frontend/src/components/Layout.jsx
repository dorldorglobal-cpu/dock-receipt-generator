import Sidebar from "./Sidebar";
import ClaudeChat from "./ClaudeChat";
import "./Layout.css";

export default function Layout({ children }) {
  return (
    <div className="app-layout">
      <Sidebar />

      <main className="main-content">
        {children}
      </main>

      <ClaudeChat />
    </div>
  );
}