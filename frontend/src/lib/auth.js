// Shared-password auth for the SPA.
// - Token comes from POST /api/auth/login and lives in localStorage.
// - A fetch() interceptor (installed once from main.jsx) attaches it as a
//   Bearer header on every API call and kicks you back to login on a 401.
// - authUrl() is for the handful of places that can't send a header: direct
//   <a href>, window.open, <iframe src> pointing at a backend PDF route.

export const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const TOKEN_KEY = "ddg_token";

export const getToken   = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };
export const setToken   = (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* storage blocked */ } };
export const clearToken = () => { try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem("ddg_auth"); } catch { /* storage blocked */ } };
export const isLoggedIn = () => !!getToken();

export function logout() {
  clearToken();
  window.location.href = "/";
}

// Append the token as a query param for header-less loads (PDF links, iframes).
export function authUrl(path) {
  const base = /^https?:\/\//i.test(path) ? path : `${API}${path.startsWith("/") ? "" : "/"}${path}`;
  const t = getToken();
  if (!t) return base;
  return base + (base.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(t);
}

// Wrap window.fetch so every request to our API carries the token, and any 401
// clears the session and reloads to the login screen.
export function installAuthInterceptor() {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const isApi = url.startsWith(API) || url.startsWith("/api");
    if (isApi) {
      const t = getToken();
      const headers = new Headers(init.headers || (typeof input !== "string" ? input.headers : undefined) || {});
      if (t && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${t}`);
      init = { ...init, headers };
    }
    const res = await realFetch(input, init);
    if (isApi && res.status === 401 && getToken()) {
      clearToken();
      window.location.href = "/";
    }
    return res;
  };
}
