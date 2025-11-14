
import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Search, Send } from "lucide-react";
// import ChatDashboard from "./ChatDashboard";
import ReactDOM from "react-dom/client";

// import "./styles/chat-widget.css";
// import "./styles/bubble.css";
// import "./styles/input.css";
// import "./styles/header.css";
// import "./styles/footer.css";
// import "./styles/scroll.css";
// import "./styles/animations.css";


/** ---------- Types ---------- */
export type ChatRole = "user" | "bot" | "agent" | "system";
export type ChatMessage = { id: string; role: ChatRole; text: string; ts: number };

/** ---------- Config ---------- */
const OPEN_LINK_IN_NEW_TAB = true;

// Handoff / escalation thresholds
const BOT_REPLY_TIMEOUT_MS = 15000;
const ESCALATE_ON_NETWORK_ERROR = true;
const ESCALATE_ON_EMPTY_REPLY = true;

// Known bot fallback strings
const BOT_FALLBACK_PATTERNS = [
  "message might be incomplete",
  "i'm not sure",
  "i am not sure",
  "i do not have that information",
  "unable to help",
  "cannot help with that",
];

/** ---------- Debug helpers (logs only) ---------- */
const DEBUG = true;
const SHOW_FULL_TOKENS = false;
const mask = (v?: string | null) => (!v ? v : `${String(v).slice(0, 6)}…${String(v).slice(-4)}`);
const show = (v?: string | null) => (SHOW_FULL_TOKENS ? v : mask(v));
function dbg(...args: any[]) { if (DEBUG) console.log(...args); }

/** ---------- Basic helpers ---------- */
function urlParam(name: string): string | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    const v = new URLSearchParams(window.location.search).get(name);
    return v || undefined;
  } catch {}
  return undefined;
}
function joinUrl(base: string, path: string): string {
  if (!base) return path;
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}
// ✔ derive ws origin from API base to avoid 403
function toWsUrl(httpBase: string): string {
  try {
    const u = new URL(httpBase);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return u.origin;
  } catch {
    const page = new URL(window.location.href);
    page.protocol = page.protocol === "https:" ? "wss:" : "ws:";
    return page.origin;
  }
}

/** ---------- Robust ENV resolvers (window → URL → Vite → LS) ---------- */
type WinCfg = { API_BASE?: string; TENANT_ID?: string };
const isBad = (v?: string | null) =>
  !v || !String(v).trim() || ["null","undefined"].includes(String(v).trim().toLowerCase());

function readWindow(keys: string[]): string | undefined {
  try {
    const w = window as any as (Window & Partial<WinCfg> & { __CHATWIDGET_CONFIG__?: WinCfg });
    const bag = w.__CHATWIDGET_CONFIG__ || w;
    for (const k of keys) {
      const val = (bag as any)[k];
      if (!isBad(val)) return String(val);
    }
  } catch {}
  return undefined;
}
function readURL(key: string): string | undefined {
  try { return new URLSearchParams(location.search).get(key) || undefined; } catch { return undefined; }
}
function readVite(keys: string[]): string | undefined {
  try {
    // @ts-ignore
    const env = (import.meta && import.meta.env) || {};
    for (const k of keys) {
      const v = env[k];
      if (!isBad(v)) return String(v);
    }
  } catch {}
  return undefined;
}
function readLS(key: string): string | undefined {
  try { return localStorage.getItem(key) || undefined; } catch { return undefined; }
}
function resolveApiBase(prop?: string) {
  return (
    prop ||
    readURL("api_base") ||
    readWindow(["API_BASE"]) ||
    readVite(["VITE_API_URL","REACT_APP_API_URL","API_BASE"]) ||
    readLS("api_base") ||
    "http://127.0.0.1:8000"
  );
}
const TENANT_LS_KEY = "tenant_id";
function resolveTenantId(prop?: string) {
  return (
    prop ||
    readURL("tenant_id") ||
    readWindow(["TENANT_ID"]) ||
    readVite(["VITE_TENANT_ID","REACT_APP_TENANT_ID","TENANT_ID"]) ||
    readLS(TENANT_LS_KEY) ||
    ""
  );
}

/** ---------- Public configuration ---------- */
const API_BASE = resolveApiBase();
const DEFAULT_CONV_ID = "";
const DEFAULT_TENANT_ID = resolveTenantId();

// DEBUG: see what vite resolved (may be undefined in embed; that's fine)
try {
  // @ts-ignore
  console.log("env dump →", import.meta?.env);
  // @ts-ignore
  console.log("VITE_TENANT_ID →", import.meta?.env?.VITE_TENANT_ID);
} catch {}

const CHAT_DASHBOARD_URL = "";
const HELP_DOCS_URL = readVite(["VITE_HELP_DOCS_URL","REACT_APP_HELP_DOCS_URL","HELP_DOCS_URL"]) || "";

// Email / support
const SUPPORT_EMAIL_URL = readVite(["VITE_SUPPORT_EMAIL_URL","REACT_APP_SUPPORT_EMAIL_URL","SUPPORT_EMAIL_URL"]) || "";
const SUPPORT_EMAIL_TO = readVite(["VITE_SUPPORT_EMAIL_TO","REACT_APP_SUPPORT_EMAIL_TO","SUPPORT_EMAIL_TO"]) || "support@gmail.com";
const SUPPORT_EMAIL_SUBJECT = readVite(["VITE_SUPPORT_EMAIL_SUBJECT","REACT_APP_SUPPORT_EMAIL_SUBJECT","SUPPORT_EMAIL_SUBJECT"]) || "Support ";
const SUPPORT_EMAIL_BODY = readVite(["VITE_SUPPORT_EMAIL_BODY","REACT_APP_SUPPORT_EMAIL_BODY","SUPPORT_EMAIL_BODY"]) || "";

/** ---------- Utilities ---------- */
const uid = () => Math.random().toString(36).slice(2, 10);
function debounce<F extends (...args: any[]) => void>(fn: F, delay = 300) {
  let t: number | undefined;
  return (...args: Parameters<F>) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), delay);
  };
}
function gmailComposeUrl(to: string, subject?: string, body?: string, accountIndex = 0): string {
  const base = `https://mail.google.com/mail/u/${accountIndex}/?view=cm&fs=1`;
  const p = new URLSearchParams();
  if (to) p.set("to", to);
  if (subject) p.set("su", subject);
  if (body) p.set("body", body);
  return `${base}&${p.toString()}`;
}

/** ---------- Agent intent detector ---------- */
function isAgentIntent(text: string): boolean {
  const t = (text || "").trim().toLowerCase();
  if (/^[\.\-_\s]{1,6}$/.test(t)) return true;
  if (t.length <= 2) return true;
  const K = [
    "talk to agent","talk to human","connect agent","connect with team","live support",
    "customer care","call me","speak to person","need human","escalate","not helpful",
    "contact support","help me person","transfer to agent"
  ];
  return K.some(k => t.includes(k));
}

/** ---------- Chat API helpers ---------- */
type RawMessage = {
  id: string;
  conversation_id: string;
  sender: "user" | "ai" | "bot" | "agent" | "system" | string;
  text?: string;
  message?: string;
  reply?: string;
  created_at?: string | number;
};
async function listMessages(apiBase: string, opts: { conversation_id: string; sender?: string; limit?: number }) {
  // FIX: use /api/messages
  const url = new URL(joinUrl(apiBase, "/api/messages"));
  url.searchParams.set("conversation_id", opts.conversation_id);
  if (opts.sender) url.searchParams.set("sender", opts.sender);
  if (opts.limit) url.searchParams.set("limit", String(opts.limit));
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? (data as RawMessage[]) : [];
}
function normalize(raw: RawMessage): ChatMessage {
  const txt = raw.text ?? raw.message ?? raw.reply ?? "";
  const s = (raw.sender || "").toLowerCase();
  const role: ChatRole = s === "user" ? "user" : s === "agent" ? "agent" : s === "system" ? "system" : "bot";
  const ts = raw.created_at ? new Date(raw.created_at).getTime() : Date.now();
  return { id: raw.id, role, text: txt, ts };
}

/** ---------- Linkify ---------- */
const URL_RE = /((https?:\/\/)[^\s<>"')\]]+)/gi;
function LinkifiedText({ text, role }: { text: string; role: ChatRole }) {
  const parts: React.ReactNode[] = [];
  let last = 0; let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    const url = m[1]; const start = m.index;
    if (start > last) parts.push(text.slice(last, start));
    const isUser = role === "user";
    const linkClass = isUser ? "underline decoration-white/70 hover:decoration-white break-all" : "text-blue-600 hover:text-blue-700 underline break-all";
    parts.push(
      <a
        key={start}
        href={url}
        target={OPEN_LINK_IN_NEW_TAB ? "_blank" : "_self"}
        rel="noopener noreferrer nofollow ugc"
        className={linkClass}
      >
        {url}
      </a>
    );
    last = start + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <span className="break-words">{parts}</span>;
}

/** ---------- AI Search (POST /api/ai-search) ---------- */
type SearchResult = { id: string; title: string; snippet?: string; url?: string; score?: number };
type AiSearchResponse = { answer_markdown?: string; citations?: unknown[] };

const SEARCH_MAX_RESULTS = 5;
const SEARCH_PATHS = ["/api/ai-search", "/api/ai-search/"];

// Robust mapping of mixed citation shapes → SearchResult[]
const TITLE_KEYS = ["title", "name", "heading", "documentTitle"];
const SNIPPET_KEYS = ["snippet", "summary", "excerpt", "text", "content", "description"];
const URL_KEYS = ["url", "link", "href", "source", "src"];
const SCORE_KEYS = ["score", "relevance", "rank", "confidence"];

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function pickDeep(obj: any, keys: string[]): unknown {
  for (const k of keys) {
    const v = obj?.[k];
    if (isStr(v) || isNum(v)) return v;
    const mv = obj?.metadata?.[k];
    if (isStr(mv) || isNum(mv)) return mv;
  }
  return undefined;
}
function validHttpUrl(s?: string): string | undefined {
  if (!isStr(s)) return undefined;
  return /^https?:\/\//i.test(s) ? s : undefined;
}
function stripHtml(input?: string): string | undefined {
  if (!isStr(input)) return undefined;
  if (!/[<>]/.test(input)) return input;
  if (typeof window === "undefined") {
    return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
  const div = document.createElement("div");
  div.innerHTML = input;
  return (div.textContent || div.innerText || "").trim();
}

function mapCitations(cites: unknown, max = SEARCH_MAX_RESULTS): SearchResult[] {
  if (!Array.isArray(cites)) return [];
  const out: SearchResult[] = [];
  const seen = new Set<string>();

  cites.forEach((row, i) => {
    if (!row || typeof row !== "object") return;
    const r = row as Record<string, unknown>;

    const url = validHttpUrl(pickDeep(r, URL_KEYS) as string | undefined);
    const scoreRaw = pickDeep(r, SCORE_KEYS);
    const score =
      isNum(scoreRaw) ? scoreRaw :
      (isStr(scoreRaw) && Number.isFinite(Number(scoreRaw)) ? Number(scoreRaw) : undefined);

    let title = pickDeep(r, TITLE_KEYS) as string | undefined;
    if (!isStr(title)) {
      title = url ? (() => { try { return new URL(url!).hostname; } catch { return undefined; } })() : undefined;
    }
    if (!title) title = `Untitled ${i + 1}`;

    let snippet = pickDeep(r, SNIPPET_KEYS) as string | undefined;
    snippet = stripHtml(snippet);

    const id =
      String(
        (r as any)?.id ??
        (r as any)?._id ??
        (r as any)?.uuid ??
        url ??
        `${i}`
      );

    const dedupeKey = url ?? `${title}|${snippet ?? ""}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    out.push({ id, title, snippet, url, score });
  });

  out.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  return out.slice(0, max);
}

async function aiSearch(apiBase: string, query: string, maxResults = SEARCH_MAX_RESULTS): Promise<{ answer?: string; results: SearchResult[] }> {
  let lastErr: any;
  for (const path of SEARCH_PATHS) {
    try {
      const url = apiBase.replace(/\/+$/, "") + path;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, max_results: maxResults }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} — ${text.slice(0, 200)}`);
      let data: AiSearchResponse | any; try { data = JSON.parse(text); } catch { throw new Error(`Non-JSON response: ${text.slice(0, 200)}…`); }

      const answer = typeof data?.answer_markdown === "string" ? data.answer_markdown : undefined;
      const raw =
        Array.isArray((data as any)?.citations) ? (data as any).citations :
        Array.isArray((data as any)?.results) ? (data as any).results :
        Array.isArray((data as any)?.data)    ? (data as any).data    :
        Array.isArray((data as any)?.items)   ? (data as any).items   :
        Array.isArray(data) ? data : [];
      const results = mapCitations(raw, maxResults);
      return { answer, results };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/** ---------- Support connect (require action) ---------- */
async function notifySupport(
  apiBase: string,
  payload: { conversation_id?: string; action: string; reason?: string }
) {
  const url = joinUrl(apiBase, "/support/connect");
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    return r.ok;
  } catch { return false; }
}

/** ---------- Send to agent (fallback to /messages with target) ---------- */
async function sendToAgent(
  apiBase: string,
  payload: { conversation_id: string; text: string; client_id?: string }
) {
  // 1. Try agent endpoint
  try {
    const r = await fetch(joinUrl(apiBase, "/agent/messages"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) return true;
  } catch (err) {
    console.warn("sendToAgent /agent/messages failed", err);
  }

  // 2. Fallback → /messages with target=agent
  try {
    const r = await fetch(joinUrl(apiBase, "/messages"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        conversation_id: payload.conversation_id,
        sender: "user",
        text: payload.text,
        client_id: payload.client_id,
        target: "agent",
        attachments: [],
      }),
    });
    return r.ok;
  } catch (err) {
    console.error("sendToAgent /messages failed", err);
    return false;
  }
}

/** ---------- UI parts ---------- */
function Bubble({ role, text }: { role: ChatRole; text: string }) {
  const classesByRole: Record<ChatRole, string> = {
    user: "bg-blue-600 text-white rounded-br-sm",
    bot: "bg-white text-slate-900 border border-slate-200 rounded-bl-sm",
    agent: "bg-emerald-600 text-white rounded-bl-sm",
    system: "bg-amber-50 text-amber-900 border border-amber-200",
  };
  const align = role === "user" ? "justify-end" : "justify-start";
  return (
    <div className={`w-full flex ${align}`}>
      <div className={`max-w-[78%] rounded-2xl px-4 py-2 text-[15px] leading-snug shadow-sm break-words ${classesByRole[role]}`}>
        <LinkifiedText role={role} text={text} />
      </div>
    </div>
  );
}

function Header({
  tab, setTab, agentMode, agentJoining, agentName,
}: {
  tab: "chat" | "helpdesk";
  setTab: (t: "chat" | "helpdesk") => void;
  agentMode: boolean;
  agentJoining: boolean;
  agentName: string | null;
}) {
  return (
    <div className="p-4 pb-3 border-b border-slate-200/80 bg-blue-600 text-white rounded-t-3xl">
      <div className="flex items-center gap-2 text-sm mb-3">
        <div className="bg-blue-700 inline-flex rounded-full p-1">
          <button onClick={() => setTab("chat")} className={`px-3 py-1 rounded-full transition ${tab === "chat" ? "bg-white text-blue-700" : "text-white/80"}`}>Chat</button>
          <button onClick={() => setTab("helpdesk")} className={`px-3 py-1 rounded-full transition ${tab === "helpdesk" ? "bg-white text-blue-700" : "text-white/80"}`}>Helpdesk</button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex -space-x-2">
          {"abcd".split("").map((c, i) => (
            <div key={i} className="h-8 w-8 rounded-full ring-2 ring-blue-600 bg-white flex items-center justify-center text-xs font-semibold text-blue-700">
              {c.toUpperCase()}
            </div>
          ))}
        </div>
        <div className="flex-1">
          <div className="font-semibold">Talk with Support! <span className="select-none">😊</span></div>
          {!agentMode ? (
            <div className="text-[12px] text-white/80 flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400"></span>
              Team replies under 1 hour
            </div>
          ) : (
            <div className="text-[12px] text-white/90 flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${agentJoining ? "bg-amber-300" : "bg-emerald-400"}`}></span>
              {agentJoining ? "Connecting you to an agent…" : `You're chatting with ${agentName || "Agent"}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QuickCard({ onSearch }: { onSearch: () => void }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3">
      <div className="text-sm text-slate-700">
        Someone will be with you shortly. In the meantime feel free to search on Helpdesk or ask me directly.
      </div>
      <button onClick={onSearch} className="mt-3 inline-flex items-center gap-2 bg-slate-900 text-white text-sm px-3 py-2 rounded-lg hover:bg-slate-800">
        <Search className="h-4 w-4" /> Search on Helpdesk
      </button>
    </div>
  );
}

function Composer({ onSend, agentMode }: { onSend: (text: string) => void | Promise<void>; agentMode: boolean }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    await onSend(t);
    setText("");
    setSending(false);
  };
  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  };
  return (
    <div className="sticky bottom-0 p-3 border-t border-slate-200 bg-white rounded-b-3xl">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={agentMode ? "Message the agent…" : "Type a message…"}
            className="w-full resize-none rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-[15px]"
          />
        </div>
        <button onClick={() => void send()} disabled={sending} className={`p-2.5 rounded-xl text-white ${sending ? "bg-blue-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"}`}>
          <Send className="h-5 w-5" />
        </button>
      </div>
      <div className="pt-2 text-[11px] text-slate-500 flex items-center gap-1">
        <Bot className="h-3.5 w-3.5" /> Powered by The Pixel Power
      </div>
    </div>
  );
}

/** ---------- Static Support Chips ---------- */
type SupportItem = { id: "connect" | "live" | "email" | "docs"; label: string };
function SupportChips({ onTap }: { onTap: (item: SupportItem) => void | Promise<void> }) {
  const items: SupportItem[] = [
    { id: "connect", label: "Connect with Team" },
    { id: "live", label: "Live Support" },
    { id: "email", label: "Email Us" },
    { id: "docs", label: "Help Docs" },
  ];
  return (
    <div className="px-3 pt-3">
      <div className="flex flex-wrap gap-2">
        {items.map((it) => (
          <button
            key={it.id}
            onClick={() => void onTap(it)}
            className="px-3 py-1.5 rounded-2xl bg-white border border-slate-200 text-sm text-slate-800 shadow-sm hover:bg-blue-50 hover:border-blue-300 transition"
            title={it.label}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** ---------- AI-powered Helpdesk ---------- */
function HelpdeskPane({ apiBase, convId }: { apiBase: string; convId?: string }) {
  const [q, setQ] = useState(""); const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [answer, setAnswer] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<number>(-1);

  // docs viewer
  const [docsOpen, setDocsOpen] = useState(false);
  const [docsUrl, setDocsUrl] = useState<string>(HELP_DOCS_URL);

  // flash
  type FlashMsg = { id: string; text: string; tone: "success" | "info" | "error" };
  const [flash, setFlash] = useState<FlashMsg[]>([]);
  const pushFlash = (text: string, tone: FlashMsg["tone"] = "success") => setFlash((f) => [...f, { id: uid(), text, tone }]);
  const removeFlash = (id: string) => setFlash((f) => f.filter((x) => x.id !== id));
  const toneCls = (t: FlashMsg["tone"]) =>
    t === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-900" :
    t === "error"   ? "bg-rose-50 border-rose-200 text-rose-900" :
                      "bg-sky-50 border-sky-200 text-sky-900";

  const handleSupportTap = async (item: SupportItem) => {
    if (item.id === "docs") {
      if (HELP_DOCS_URL) { setDocsUrl(HELP_DOCS_URL); setDocsOpen(true); }
      else { await notifySupport(apiBase, { conversation_id: convId, action: "open_docs_missing_url" }); pushFlash("Help docs URL is not configured. Please contact support.", "error"); }
      return;
    }
    if (item.id === "email") {
      if (SUPPORT_EMAIL_URL) {
        if (SUPPORT_EMAIL_URL.startsWith("mailto:")) window.location.href = SUPPORT_EMAIL_URL;
        else window.open(SUPPORT_EMAIL_URL, OPEN_LINK_IN_NEW_TAB ? "_blank" : "_self", "noopener,noreferrer");
      } else {
        const subject = (SUPPORT_EMAIL_SUBJECT?.trim()?.length ? `${SUPPORT_EMAIL_SUBJECT} (${convId || "no-conv-id"})` : `Support request (${convId || "no-conv-id"})`);
        const body = (SUPPORT_EMAIL_BODY?.trim()?.length ? `${SUPPORT_EMAIL_BODY}\n\nConversation ID: ${convId || "-"}` : `\n`);
        const gmailHref = gmailComposeUrl(SUPPORT_EMAIL_TO, subject, body, 0);
        window.open(gmailHref, "_blank", "noopener,noreferrer");
      }
      await notifySupport(apiBase, { conversation_id: convId, action: "email", reason: "chip_click" });
      pushFlash("Email composer opened — our team will follow up shortly.", "info");
      return;
    }
    if (item.id === "live") {
      const dest = (CHAT_DASHBOARD_URL || "/chat")
        .replace("{convId}", encodeURIComponent(convId || ""))
        .replace("{conversation_id}", encodeURIComponent(convId || ""))
        .replace("{tenantId}", encodeURIComponent(DEFAULT_TENANT_ID || ""));
      window.location.assign(dest);
      void notifySupport(apiBase, { conversation_id: convId, action: "live", reason: "chip_click" });
      return;
    }
    if (item.id === "connect") {
      await notifySupport(apiBase, { conversation_id: convId, action: "connect", reason: "chip_click" });
      pushFlash("We're on it! A human will hop in shortly", "success");
      return;
    }
    await notifySupport(apiBase, { conversation_id: convId, action: item.id, reason: "chip_click" });
    pushFlash("We'll connect you with our team shortly.", "success");
  };

  const doSearch = async (query: string) => {
    if (!query.trim()) { setResults([]); setAnswer(undefined); setError(null); setLoading(false); return; }
    try {
      setLoading(true); setError(null);
      const out = await aiSearch(apiBase, query.trim(), SEARCH_MAX_RESULTS);
      setAnswer(out.answer); setResults(out.results);
    } catch (e: any) {
      setError(e?.message || "Search failed."); setAnswer(undefined); setResults([]);
    } finally { setLoading(false); }
  };
  const debounced = useRef(debounce((value: string) => { void doSearch(value); }, 350)).current;
  useEffect(() => { debounced(q); }, [q, debounced]);

  const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (!results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % results.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + results.length) % results.length); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[active >= 0 ? active : 0];
      if (pick?.url) window.open(pick.url, OPEN_LINK_IN_NEW_TAB ? "_blank" : "_self", "noopener,noreferrer");
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 relative">
      <div className="p-3 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2 bg-white rounded-xl border px-3 py-2">
          <Search className="h-4 w-4 text-slate-500" />
          <input className="flex-1 outline-none text-sm" placeholder="Ask anything" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} />
          {q && <button onClick={() => { setQ(""); setResults([]); setAnswer(undefined); setError(null); }} className="text-[11px] text-slate-500 hover:text-slate-700">Clear</button>}
        </div>
        <SupportChips onTap={handleSupportTap} />

        {flash.length > 0 && (
          <div className="mt-2 space-y-2">
            {flash.map((m) => (
              <div key={m.id} className={`rounded-lg border px-3 py-2 text-sm ${toneCls(m.tone)}`}>
                <div className="flex items-start justify-between gap-3">
                  <span>{m.text}</span>
                  <button onClick={() => removeFlash(m.id)} className="text-xs opacity-70 hover:opacity-100" aria-label="Dismiss">Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {loading && <div className="text-sm text-slate-600">Searching…</div>}
        {error && (
          <div className="text-sm text-rose-600 whitespace-pre-wrap">
            {error}
            <button className="ml-2 text-[11px] underline" onClick={() => navigator.clipboard.writeText(error)}>copy</button>
          </div>
        )}

        {!loading && !error && answer && (
          <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-[13px] leading-relaxed text-slate-800">
            {answer}
          </div>
        )}

        {!loading && !error && results.length > 0 && (
          <>
            <div className="text-[12px] text-slate-500 mb-2">{results.length} result(s)</div>
            <ul className="space-y-2">
              {results.map((r, idx) => (
                <li
                  key={r.id}
                  className={`rounded-xl border p-3 bg-white hover:bg-slate-50 transition cursor-pointer ${active === idx ? "ring-2 ring-blue-500" : "border-slate-200"}`}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => r.url && window.open(r.url, OPEN_LINK_IN_NEW_TAB ? "_blank" : "_self", "noopener,noreferrer")}
                >
                  <div className="text-sm font-medium text-slate-900">{r.title}</div>
                  {r.snippet && <div className="text-[13px] text-slate-600 mt-1 line-clamp-3">{r.snippet}</div>}
                  {r.url && (
                    <div className="text-[12px] mt-1">
                      <a href={r.url} target={OPEN_LINK_IN_NEW_TAB ? "_blank" : "_self"} rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">{r.url}</a>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {!loading && !error && results.length === 0 && q && (
          <div className="text-sm text-slate-600">No results for "{q}".</div>
        )}
      </div>

      {docsOpen && (
        <div className="absolute inset-0 z-20 bg-white rounded-t-3xl shadow-lg border-l border-r border-slate-200">
          <div className="h-10 px-3 flex items-center justify-between border-b border-slate-200">
            <div className="text-sm font-medium">Help Docs</div>
            <div className="flex items-center gap-2">
              {HELP_DOCS_URL && <a href={HELP_DOCS_URL} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">Open in new tab</a>}
              <button onClick={() => setDocsOpen(false)} className="text-xs bg-slate-100 hover:bg-slate-200 rounded px-2 py-1">Close</button>
            </div>
          </div>
          {HELP_DOCS_URL ? (
            <iframe title="help-docs" src={docsUrl} className="w-full h-[calc(100%-40px)] border-0" />
          ) : (
            <div className="p-4 text-sm text-slate-600">
              No <code>HELP_DOCS_URL</code> configured. Set it via env (e.g., <code>VITE_HELP_DOCS_URL</code>).
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** ---------- Scrolling helpers ---------- */
function isNearBottom(el: HTMLDivElement, threshold = 64) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

/** ---------- Main Panel (bot + agent handoff) ---------- */

// Tenants
const TENANT_KEY = "tenant_id";
function getResolvedTenantId(explicit?: string) {
  return resolveTenantId(explicit);
}

function ChatPane({
  messages, onSend, goHelpdesk, agentMode,
}: { messages: ChatMessage[]; onSend: (t: string) => Promise<void> | void; goHelpdesk: () => void; agentMode: boolean; }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [hasUnseen, setHasUnseen] = useState(false);

  useEffect(() => {
    const el = scrollerRef.current; if (!el) return;
    const onScroll = () => { const atBottom = isNearBottom(el); if (atBottom) setHasUnseen(false); };
    el.addEventListener("scroll", onScroll, { passive: true }); onScroll(); return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const prevLen = useRef(0);
  useEffect(() => {
    const el = scrollerRef.current; if (!el) return;
    const wasNear = isNearBottom(el);
    const gotNew = messages.length > prevLen.current;
    prevLen.current = messages.length;
    if (gotNew) { if (wasNear) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); else setHasUnseen(true); }
  }, [messages]);

  const jumpToBottom = () => { const el = scrollerRef.current; if (!el) return; el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); setHasUnseen(false); };

  return (
    <div className="relative h-full flex flex-col bg-slate-50">
      <div ref={scrollerRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 scroll-smooth" style={{ overscrollBehavior: "contain" }}>
        <div className="w-full flex justify-start"><QuickCard onSearch={goHelpdesk} /></div>
        {messages.map((m) => <Bubble key={m.id + String(m.ts)} role={m.role} text={m.text} />)}
        {hasUnseen && (
          <div className="sticky bottom-2 flex justify-center pt-6">
            <span className="inline-flex items-center gap-2 text-xs bg-white border border-slate-200 rounded-full px-3 py-1 shadow-sm">
              New messages <button onClick={jumpToBottom} className="text-blue-600 hover:underline">Jump</button>
            </span>
          </div>
        )}
      </div>
      <Composer onSend={onSend} agentMode={agentMode} />
    </div>
  );
}

function Panel({
  onClose, apiBase, initialConvId, storageKey = "conv_id", autoCreate = true, tenantId = DEFAULT_TENANT_ID, enableWebSocket = true,
}: {
  onClose: () => void; apiBase: string; initialConvId?: string; storageKey?: string; autoCreate?: boolean; tenantId?: string; enableWebSocket?: boolean;
}) {
  const [tab, setTab] = useState<"chat" | "helpdesk">("chat");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Agent state
  const [agentMode, setAgentMode] = useState(false);
  const [agentJoining, setAgentJoining] = useState(false);
  const [agentName, setAgentName] = useState<string | null>(null);

  // Bot timeout refs
  const botPendingSinceRef = useRef<number | null>(null);
  const botTimeoutTimerRef = useRef<number | null>(null);

  // WS refs
  const wsRef = useRef<WebSocket | null>(null);
  const wsHeartbeatRef = useRef<number | null>(null);
  const wsReconnectAttempts = useRef(0);

  // 🔑 token state to control WS timing
  const [token, setToken] = useState<string | null>(() => (typeof localStorage !== "undefined" ? localStorage.getItem("chat_token") : null));

  const [convId, setConvId] = useState<string>(
    () =>
      initialConvId ||
      urlParam("conv_id") ||
      (typeof window !== "undefined" ? (window as any)["CONVERSATION_ID"] : undefined) ||
      (typeof localStorage !== "undefined" ? localStorage.getItem(storageKey) || "" : "") ||
      DEFAULT_CONV_ID
  );
  useEffect(() => { try { if (convId) localStorage.setItem(storageKey, convId); } catch {} }, [convId, storageKey]);

  // ⬇️ Extracted init function (so we can call it from multiple places)
  const initWidget = async () => {
    try {
      const resolvedTenantId = getResolvedTenantId(tenantId);
      if (!resolvedTenantId) {
        console.error("❌ initWidget: tenant_id missing (props/URL/window/env/LS). Aborting init.");
        return;
      }

      const url = joinUrl(apiBase, "/api/widget/init");
      const payload = { tenant_id: resolvedTenantId };

      dbg("[⚙️ Initializing Widget] POST", url, "payload:", payload);

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });

      dbg("[⚙️ Init Response status]", res.status);
      if (!res.ok) {
        console.error("❌ Widget init failed:", res.status);
        return;
      }

      const data = await res.json();
      dbg("[✅ Init JSON]", {
        conversation_id: data?.conversation_id,
        token: show(data?.token || data?.access_token),
      });

      if (data?.conversation_id) {
        setConvId(data.conversation_id);
        try {
          localStorage.setItem(storageKey, data.conversation_id);
        } catch {}
      }

      const t = data?.token || data?.access_token || null;
      if (t) {
        try { localStorage.setItem("chat_token", t); } catch {}
        setToken(t); // <-- WS will wait for this
      } else {
        console.warn("⚠️ No token returned from /api/widget/init");
        setToken(null);
      }

      // Save tenant we used
      try { localStorage.setItem(TENANT_LS_KEY, resolvedTenantId); } catch {}
    } catch (err) {
      console.error("❌ Error during widget init:", err);
    }
  };

  // ✅ Init effect (runs once) with tenant-change detection
  useEffect(() => {
    (async () => {
      if (!autoCreate) return;

      const currentTenant = getResolvedTenantId(tenantId);
      const savedTenant = (typeof localStorage !== "undefined" && localStorage.getItem(TENANT_LS_KEY)) || "";

      if (!currentTenant) {
        console.error("❌ No tenant id (props/URL/window/env/LS). Skipping init.");
        return;
      }

      // Tenant changed → clear old auth/conv so we force a fresh init
      if (savedTenant && currentTenant !== savedTenant) {
        dbg("🔁 Tenant changed → clearing old state", { savedTenant, currentTenant });
        try {
          localStorage.removeItem("chat_token");
          localStorage.removeItem(storageKey);
          localStorage.setItem(TENANT_LS_KEY, currentTenant);
        } catch {}
      }

      const existingToken = token || (typeof localStorage !== "undefined" ? localStorage.getItem("chat_token") : null);
      const existingConv  = convId && convId !== DEFAULT_CONV_ID;

      if (existingConv && existingToken) {
        dbg("↪️ Skip init (already have conv & token)", { convId, token: show(existingToken) });
        try { localStorage.setItem(TENANT_LS_KEY, currentTenant); } catch {}
        return;
      }

      await initWidget();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load history after we have conversation id
  useEffect(() => {
    if (!convId || convId === DEFAULT_CONV_ID) return;
    let cancelled = false;
    (async () => {
      try {
        setLoadingHistory(true);
        const raw = await listMessages(apiBase, { conversation_id: convId, limit: 500 });
        if (cancelled) return;
        const mapped = raw.map(normalize); mapped.sort((a, b) => a.ts - b.ts);
        setMessages(mapped);
      } catch (e) {
        console.warn("Failed to load history:", e);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, convId]);

  // const add = (role: ChatRole, text: string, id?: string) =>
  //   setMessages((prev) => {
  //     if (id && prev.some((m) => m.id === id)) return prev;
  //     const next = [...prev, { id: id || uid(), role, text, ts: Date.now() }];
  //     next.sort((a, b) => a.ts - b.ts);
  //     return next;
  //   });

  const add = (role: ChatRole, text: string, id?: string) =>
  setMessages((prev) => {
    const trimmed = (text || "").trim();
    if (!trimmed) return prev;

    // id ഉണ്ടെങ്കിൽ same id രണ്ടുമുറി വരാതിരിക്കാൻ
    if (id && prev.some((m) => m.id === id)) return prev;

    const next = [
      ...prev,
      { id: id || uid(), role, text: trimmed, ts: Date.now() },
    ];
    next.sort((a, b) => a.ts - b.ts);
    return next;
  });


  // Escalation helpers
  async function escalateToAgent(reason: "bot_timeout" | "network_error" | "empty_reply" | "user_intent") {
    if (agentMode || agentJoining) return;
    setAgentJoining(true);
    add("system", "Connecting you to a human agent…");
    void notifySupport(apiBase, { conversation_id: convId, action: reason, reason });
    setAgentMode(true);
  }
  function startBotTimeout() {
    if (botTimeoutTimerRef.current) window.clearTimeout(botTimeoutTimerRef.current);
    botPendingSinceRef.current = Date.now();
    botTimeoutTimerRef.current = window.setTimeout(() => { void escalateToAgent("bot_timeout"); }, BOT_REPLY_TIMEOUT_MS);
  }
  function clearBotTimeout() {
    if (botTimeoutTimerRef.current) window.clearTimeout(botTimeoutTimerRef.current);
    botTimeoutTimerRef.current = null; botPendingSinceRef.current = null;
  }

  // SEND with user-intent escalation
  const onSend = async (text: string) => {
    // Only add locally if WS not open
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      add("user", text);
    }

    // User explicitly wants to talk to a human agent
    if (!agentMode && isAgentIntent(text)) {
      await escalateToAgent("user_intent");
      return;
    }

    // If agent mode is active → send via agent pipeline
    if (agentMode) {
      try {
        wsRef.current?.send(JSON.stringify({ sender: "user", text }));
      } catch {}
      const ok = await sendToAgent(apiBase, {
        conversation_id: convId || DEFAULT_CONV_ID,
        text,
      });
      if (!ok) add("system", "Couldn't reach the agent. We'll keep trying.");
      return;
    }

    // Bot pipeline (main AI route)
    try {
      startBotTimeout();

      const tkn = token || localStorage.getItem("chat_token");
      const senderId = getSenderId();
      const conversationId = convId || DEFAULT_CONV_ID;

      const payload = {
        conversation_id: conversationId,
        sender_id: senderId,
        text,
      };

      dbg("[📤 Sending message to API]", {
        url: joinUrl(apiBase, "/api/messages"),
        payload,
        auth: tkn ? "Bearer " + show(tkn) : "(no token)",
      });

      const res = await fetch(joinUrl(apiBase, "/api/messages"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(tkn ? { Authorization: `Bearer ${tkn}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      dbg("[✅ Response Status]", res.status);
      const data = await res.json().catch(() => ({}));
      dbg("[📥 Response Data]", data);

      clearBotTimeout();

      if (!res.ok) {
        add("bot", "Sorry, there was a network issue.");
        if (ESCALATE_ON_NETWORK_ERROR) await escalateToAgent("network_error");
        return;
      }

      // Store updated conversation_id if backend returns one
      if (data?.conversation_id && data.conversation_id !== convId) {
        setConvId(data.conversation_id);
        try {
          localStorage.setItem(storageKey, data.conversation_id);
        } catch {}
      }

      // Extract AI reply text
      // const reply =
      //   data?.text ||
      //   data?.message ||
      //   data?.reply ||
      //   data?.payload?.text ||
      //   "";

      // if (!reply || reply.trim() === "…") {
      //   add("bot", "Hmm, I don't have a good answer to that.");
      //   if (ESCALATE_ON_EMPTY_REPLY) await escalateToAgent("empty_reply");
      // } else {
      //   add("bot", reply);
      //   const lower = reply.toLowerCase();
      //   if (BOT_FALLBACK_PATTERNS.some((p) => lower.includes(p))) {
      //     await escalateToAgent("empty_reply");
      //   }
      // }
      // Extract AI reply text
const reply =
  data?.text ||
  data?.message ||
  data?.reply ||
  data?.payload?.text ||
  "";

// Try to get a stable message id from backend
const botId =
  data?.id ||
  data?.message?.id ||
  data?.payload?.id ||
  undefined;

if (!reply || reply.trim() === "…") {
  add("bot", "Hmm, I don't have a good answer to that.", botId);
  if (ESCALATE_ON_EMPTY_REPLY) await escalateToAgent("empty_reply");
} else {
  add("bot", reply, botId);  // 👈 ഇവിടെ id pass ചെയ്യുന്നു
  const lower = reply.toLowerCase();
  if (BOT_FALLBACK_PATTERNS.some((p) => lower.includes(p))) {
    await escalateToAgent("empty_reply");
  }
}
    } catch (err) {
      clearBotTimeout();
      console.error("❌ /api/messages error:", err);
      add("bot", "Network error. Please try again.");
      if (ESCALATE_ON_NETWORK_ERROR) await escalateToAgent("network_error");
    }
  };

  function getSenderId(): string {
    try {
      const key = "chat_sender_id";
      let senderId = localStorage.getItem(key);
      if (!senderId) {
        senderId = "user_" + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(key, senderId);
      }
      return senderId;
    } catch {
      return "user_" + Math.random().toString(36).slice(2, 10);
    }
  }

  // 🔑 WebSocket setup with token authentication — WAITS for token
  useEffect(() => {
    if (!enableWebSocket) return;
    if (!convId || convId === DEFAULT_CONV_ID) return;

    const widgetToken = token || localStorage.getItem("chat_token");
    if (!widgetToken) {
      dbg("[WS] waiting for token…");
      return; // do not connect until we have a token
    }

    let cancelled = false;
    const wsOrigin = toWsUrl(apiBase);

    dbg("[WS] origin:", wsOrigin);
    dbg("[WS] convId:", convId);
    dbg("[WS] token:", show(widgetToken));

    // ✅ Build WebSocket URL with token parameter
    const url = `${wsOrigin}/ws/conversations/${encodeURIComponent(convId)}?token=${encodeURIComponent(widgetToken)}`;
    const safeUrl = url.replace(widgetToken, "***TOKEN***");
    dbg("[🔌 WebSocket connecting to]", safeUrl);

    const seenMessages = new Set<string>();

    const openWs = () => {
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          dbg("✅ WebSocket connected successfully");
          wsReconnectAttempts.current = 0;
          // heartbeat ping every 20s
          if (wsHeartbeatRef.current) window.clearInterval(wsHeartbeatRef.current);
          wsHeartbeatRef.current = window.setInterval(() => {
            try {
              ws.send(JSON.stringify({ type: "ping", at: Date.now() }));
            } catch {}
          }, 20000);
        };

        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);

            // Skip duplicate messages
            if (msg?.id && seenMessages.has(msg.id)) {
              dbg("⚠️ Duplicate skipped:", msg.id);
              return;
            }
            if (msg?.id) seenMessages.add(msg.id);

            // Handle agent assignment
            if (msg?.type === "agent.assigned") {
              setAgentName(msg.name || "Agent");
              setAgentJoining(false);
              setAgentMode(true);
              add("system", `${msg.name || "Agent"} joined the chat.`);
              return;
            }

            // Main message handler
            if (msg?.type === "message") {
              if (msg.scope === "tenant") return;
              const sender = (msg.sender || "").toLowerCase();
              const role: ChatRole =
                sender === "user"
                  ? "user"
                  : sender === "agent"
                  ? "agent"
                  : sender === "system"
                  ? "system"
                  : "bot";

              if (msg.text?.trim()) {
                add(role, msg.text, msg.id);
                dbg("✅ Added:", msg);
              }
              return;
            }

            // Legacy fallbacks
            if (msg?.type === "message.created" && msg?.message) {
              const m = msg.message;
              const sender = (m.sender || "").toLowerCase();
              const role: ChatRole =
                sender === "user"
                  ? "user"
                  : sender === "agent"
                  ? "agent"
                  : sender === "system"
                  ? "system"
                  : "bot";
              if (m.text?.trim()) add(role, m.text, m.id);
              return;
            }

            if (Array.isArray(msg?.messages)) {
              for (const m of msg.messages) {
                const sender = (m.sender || "").toLowerCase();
                const role: ChatRole =
                  sender === "user"
                    ? "user"
                    : sender === "agent"
                    ? "agent"
                    : sender === "system"
                    ? "system"
                    : "bot";
                if (m.text?.trim()) add(role, m.text, m.id);
              }
              return;
            }
          } catch (err) {
            console.warn("WS message parse error:", err);
          }
        };

        // reconnect with backoff
        const scheduleReconnect = () => {
          if (cancelled) return;
          if (wsHeartbeatRef.current) {
            window.clearInterval(wsHeartbeatRef.current);
            wsHeartbeatRef.current = null;
          }
          const attempt = Math.min(wsReconnectAttempts.current + 1, 6);
          wsReconnectAttempts.current = attempt;
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          dbg(`⏳ WebSocket reconnecting in ${delay}ms (attempt ${attempt})`);
          window.setTimeout(() => {
            if (!cancelled) openWs();
          }, delay);
        };

        ws.onclose = (evt) => {
          dbg("🔌 WebSocket closed:", evt.code, evt.reason);
          // auth-like close codes → clear token & re-init
          if ([4001, 4401, 4403, 1008].includes(evt.code)) {
            try { localStorage.removeItem("chat_token"); } catch {}
            setToken(null);
            void initWidget();
            return;
          }
          scheduleReconnect();
        };
        ws.onerror = (err) => {
          console.error("❌ WebSocket error:", err);
          scheduleReconnect();
        };
      } catch (e) {
        console.warn("WS init failed:", e);
      }
    };

    openWs();

    return () => {
      cancelled = true;
      if (wsHeartbeatRef.current) {
        window.clearInterval(wsHeartbeatRef.current);
        wsHeartbeatRef.current = null;
      }
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
    };
  }, [apiBase, convId, enableWebSocket, token]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
      transition={{ type: "spring", damping: 20, stiffness: 240 }}
      className="w-[360px] sm:w-[380px] h-[600px] bg-white rounded-3xl shadow-2xl ring-1 ring-slate-200/70 overflow-hidden flex flex-col"
    >
      <Header tab={tab} setTab={setTab} agentMode={agentMode} agentJoining={agentJoining} agentName={agentName} />
      <div className="flex-1 min-h-0">
        {tab === "chat" ? (
          <>
            {loadingHistory && <div className="px-4 py-2 text-[12px] text-slate-500">Loading previous messages…</div>}
            <ChatPane messages={messages} onSend={onSend} goHelpdesk={() => setTab("helpdesk")} agentMode={agentMode} />
          </>
        ) : (
          <HelpdeskPane apiBase={apiBase} convId={convId} />
        )}
      </div>
    </motion.div>
  );
}

/** ---------- Floating Launcher ---------- */
export default function ChatWidgetDemo(
  props: {
    apiBase?: string;
    conversationId?: string;
    storageKey?: string;
    autoCreate?: boolean;
    tenantId?: string;
    enableWebSocket?: boolean;
  } = {}
) {
  const [open, setOpen] = useState(false);

  const apiBase = props.apiBase || readWindow(["API_BASE"]) || API_BASE;
  const initialConvId =
    props.conversationId ||
    urlParam("conv_id") ||
    readWindow(["CONVERSATION_ID"]) ||
    DEFAULT_CONV_ID;
  const storageKey = props.storageKey || "conv_id";
  const autoCreate = props.autoCreate ?? true;
  const tenantId = props.tenantId || readWindow(["TENANT_ID"]) || DEFAULT_TENANT_ID;
  const enableWebSocket = props.enableWebSocket ?? true;

  // Render internal /chat route directly (optional)
  const isInternalRoute = CHAT_DASHBOARD_URL.startsWith("/");
  const isChatPage =
    isInternalRoute &&
    typeof window !== "undefined" &&
    window.location.pathname === CHAT_DASHBOARD_URL;
  // if (isChatPage) return <ChatDashboard />;

  // ✅ Only floating icon + chat box overlay, no demo text / white background
  return (
    <>
      {/* Launcher icon – bottom-right */}
      <button
        onClick={() => setOpen(true)}
        className="fixed right-6 bottom-6 h-14 w-14 rounded-full grid place-items-center bg-blue-600 text-white shadow-xl hover:bg-blue-700"
        aria-label="Open chat"
      >
        <Bot className="h-6 w-6" />
      </button>

      {/* Chat box overlay */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 grid place-items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-slate-900/60 z-0"
              onClick={() => setOpen(false)}
            />
            <div
              className="relative z-10"
              onClick={(e) => e.stopPropagation()}
            >
              <Panel
                onClose={() => setOpen(false)}
                apiBase={apiBase}
                initialConvId={initialConvId}
                storageKey={storageKey}
                autoCreate={autoCreate}
                tenantId={tenantId}
                enableWebSocket={enableWebSocket}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}


/** ---------- Global init for <script> embed ---------- */
export function initChatWidget(options: {
  apiBase?: string;
  containerId?: string;
}) {
  const containerId = options.containerId || "chat-root";
  const el = document.getElementById(containerId);
  if (!el) {
    console.error(`ChatWidget: container #${containerId} not found`);
    return;
  }

  const root = ReactDOM.createRoot(el);
  root.render(<ChatWidgetDemo apiBase={options.apiBase} />);
}

// Expose globally when bundled
if (typeof window !== "undefined") {
  (window as any).ChatWidget = { initChatWidget };
}

// (unused stubs kept to match your file; not called)
function loadConversationHistory(conversation_id: any) { /* no-op */ }
function startWebSocket(conversation_id: any, token: any) { /* no-op */ }
