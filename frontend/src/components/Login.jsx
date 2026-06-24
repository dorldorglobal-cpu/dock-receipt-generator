import { useState } from "react";
import logo from "../logo.png";

const PASSWORD = import.meta.env.VITE_APP_PASSWORD;

export default function Login({ onLogin }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  const attempt = () => {
    if (input === PASSWORD) {
      localStorage.setItem("ddg_auth", "1");
      onLogin();
    } else {
      setError(true);
      setInput("");
      setTimeout(() => setError(false), 2000);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--bg-base)",
    }}>
      <div style={{
        background: "#161b22", border: "1px solid #21262d", borderRadius: 16,
        padding: "48px 40px", width: 340, textAlign: "center",
        boxShadow: "0 8px 40px #0008",
      }}>
        <img src={logo} alt="DDG" style={{ height: 56, marginBottom: 20 }} />
        <div style={{ color: "var(--text-primary)", fontSize: 20, fontWeight: 700, marginBottom: 4 }}>DDG OPS</div>
        <div style={{ color: "var(--text-secondary)", fontSize: 13, marginBottom: 32 }}>Operations Platform</div>

        <input
          type="password"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && attempt()}
          placeholder="Enter password"
          autoFocus
          style={{
            width: "100%", padding: "11px 14px", borderRadius: 8, fontSize: 14,
            background: "var(--bg-base)", border: `1px solid ${error ? "#f85149" : "#30363d"}`,
            color: "var(--text-primary)", outline: "none", marginBottom: 12, boxSizing: "border-box",
            transition: "border-color 0.2s",
          }}
        />

        {error && (
          <div style={{ color: "#f85149", fontSize: 12, marginBottom: 10 }}>
            Incorrect password. Try again.
          </div>
        )}

        <button
          onClick={attempt}
          style={{
            width: "100%", padding: "11px", borderRadius: 8, fontSize: 14, fontWeight: 600,
            background: "linear-gradient(135deg,#1a6ef7,#0e4db5)", border: "none",
            color: "#fff", cursor: "pointer",
          }}
        >
          Sign In
        </button>

        <div style={{ color: "#484f58", fontSize: 11, marginTop: 24 }}>
          DDG Global Logistics · Internal Use Only
        </div>
      </div>
    </div>
  );
}
