import { useState } from "react";
import logo from "../logo.png";
import { API, setToken } from "../lib/auth";

export default function Login({ onLogin }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const attempt = async () => {
    if (!input || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: input }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        setToken(data.token);
        onLogin();
      } else {
        setError(data.error || "Incorrect password.");
        setInput("");
      }
    } catch {
      setError("Can't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--bg-base)",
    }}>
      <div style={{
        background: "var(--bg-elevated)", border: "1px solid var(--border-muted)", borderRadius: 16,
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
          disabled={busy}
          style={{
            width: "100%", padding: "11px 14px", borderRadius: 8, fontSize: 14,
            background: "var(--bg-base)", border: `1px solid ${error ? "#f85149" : "var(--border)"}`,
            color: "var(--text-primary)", outline: "none", marginBottom: 12, boxSizing: "border-box",
            transition: "border-color 0.2s",
          }}
        />

        {error && (
          <div style={{ color: "#f85149", fontSize: 12, marginBottom: 10 }}>
            {error}
          </div>
        )}

        <button
          onClick={attempt}
          disabled={busy}
          style={{
            width: "100%", padding: "11px", borderRadius: 8, fontSize: 14, fontWeight: 600,
            background: "linear-gradient(135deg,#2563eb,#0e4db5)", border: "none",
            color: "#fff", cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Signing in…" : "Sign In"}
        </button>

        <div style={{ color: "#484f58", fontSize: 11, marginTop: 24 }}>
          DDG Global Logistics · Internal Use Only
        </div>
      </div>
    </div>
  );
}
