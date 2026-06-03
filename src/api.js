import { API_URL } from "./config.js";

function authHeaders(extra = {}) {
  const token = localStorage.getItem("luna_token") || "";
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function api(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: authHeaders(options.headers || {})
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { error: text }; }
  if (!res.ok) return { data: null, error: { message: json.error || json.message || "API error" } };
  return json;
}

class QueryBuilder {
  constructor(table) {
    this.table = table;
    this.action = "select";
    this.payload = null;
    this.filters = [];
    this.orders = [];
    this.limitValue = null;
    this.wantSingle = false;
    this.wantMaybeSingle = false;
    this.wantSelectAfterWrite = false;
    this.countMode = false;
  }
  select(columns = "*", opts = {}) {
    this.action = this.action === "update" || this.action === "insert" || this.action === "upsert" ? this.action : "select";
    this.columns = columns;
    if (opts && opts.count === "exact") this.countMode = true;
    if (opts && opts.head) this.headMode = true;
    if (["update", "insert", "upsert"].includes(this.action)) this.wantSelectAfterWrite = true;
    return this;
  }
  insert(payload) { this.action = "insert"; this.payload = payload; return this; }
  upsert(payload) { this.action = "upsert"; this.payload = payload; return this; }
  update(payload) { this.action = "update"; this.payload = payload; return this; }
  delete() { this.action = "delete"; return this; }
  eq(key, value) { this.filters.push({ op: "eq", key, value }); return this; }
  in(key, values) { this.filters.push({ op: "in", key, values }); return this; }
  order(key, opts = {}) { this.orders.push({ key, ascending: opts.ascending !== false }); return this; }
  limit(n) { this.limitValue = n; return this; }
  single() { this.wantSingle = true; return this; }
  maybeSingle() { this.wantMaybeSingle = true; return this; }
  async exec() {
    return api(`/api/table/${encodeURIComponent(this.table)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: this.action,
        payload: this.payload,
        filters: this.filters,
        orders: this.orders,
        limit: this.limitValue,
        single: this.wantSingle,
        maybeSingle: this.wantMaybeSingle,
        selectAfterWrite: this.wantSelectAfterWrite,
        count: this.countMode,
        head: this.headMode
      })
    });
  }
  then(resolve, reject) { return this.exec().then(resolve, reject); }
}

export const supabase = {
  auth: {
    async getUser() {
      const out = await api("/api/auth/me");
      return { data: { user: out.data || null }, error: out.error || null };
    },
    async signInWithOAuth({ provider }) {
      window.location.href = `${API_URL}/auth/${provider || "discord"}?returnTo=${encodeURIComponent(window.location.href)}`;
    },
    async signOut() {
      localStorage.removeItem("luna_token");
      await api("/api/auth/logout", { method: "POST" });
    }
  },
  from(table) { return new QueryBuilder(table); },
  storage: {
    from(bucket) {
      return {
        async upload(fileName, file) {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("fileName", fileName);
          return api(`/api/upload/${encodeURIComponent(bucket)}`, { method: "POST", body: fd });
        },
        getPublicUrl(fileName) {
          return { data: { publicUrl: `${API_URL}/uploads/${encodeURIComponent(bucket)}/${fileName}` } };
        },
        async remove(paths) {
          return api(`/api/upload/${encodeURIComponent(bucket)}/remove`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths })
          });
        }
      };
    }
  },
  channel() {
    return { on() { return this; }, subscribe() { return this; } };
  }
};

window.supabase = supabase;

const params = new URLSearchParams(window.location.search);
const token = params.get("token");
if (token) {
  localStorage.setItem("luna_token", token);
  params.delete("token");
  const clean = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
  history.replaceState({}, "", clean);
}
