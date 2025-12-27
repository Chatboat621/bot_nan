
import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Search, Send } from "lucide-react";
import ReactDOM from "react-dom/client";
import "./styles/chat-widget.css";

/** ---------- Types ---------- */
export type ChatRole = "user" | "bot" | "agent" | "system";
export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  ts: number;
};

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

/** ---------- Debug helpers ---------- */
const DEBUG = true;
const SHOW_FULL_TOKENS = false;
const mask = (v?: string | null) =>
  !v ? v : `${String(v).slice(0, 6)}…${String(v).slice(-4)}`;
const show = (v?: string | null) => (SHOW_FULL_TOKENS ? v : mask(v));
function dbg(...args: any[]) {
  if (DEBUG) console.log(...args);
}

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

/** ---------- Env resolver helpers (fallback) ---------- */
type WinCfg = { API_BASE?: string; TENANT_ID?: string };
const isBad = (v?: string | null) =>
  !v ||
  !String(v).trim() ||
  ["null", "undefined"].includes(String(v).trim().toLowerCase());

function readWindow(keys: string[]): string | undefined {
  try {
    const w = window as any as Window &
      Partial<WinCfg> & { __CHATWIDGET_CONFIG__?: WinCfg };
    const bag = w.__CHATWIDGET_CONFIG__ || w;
    for (const k of keys) {
      const val = (bag as any)[k];
      if (!isBad(val)) return String(val);
    }
  } catch {}
  return undefined;
}
function readURL(key: string): string | undefined {
  try {
    return new URLSearchParams(location.search).get(key) || undefined;
  } catch {
    return undefined;
  }
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
  try {
    return localStorage.getItem(key) || undefined;
  } catch {
    return undefined;
  }
}
/** ---------- Cookie helpers ---------- */
function setCookie(name: string, value: string, hours: number = 24) {
  try {
    const expires = new Date();
    expires.setTime(expires.getTime() + hours * 60 * 60 * 1000);
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
  } catch (e) {
    console.warn("Failed to set cookie:", e);
  }
}

function getCookie(name: string): string | undefined {
  try {
    const nameEQ = name + "=";
    const cookies = document.cookie.split(";");
    for (let i = 0; i < cookies.length; i++) {
      let c = cookies[i];
      while (c.charAt(0) === " ") c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) {
        return decodeURIComponent(c.substring(nameEQ.length, c.length));
      }
    }
  } catch (e) {
    console.warn("Failed to get cookie:", e);
  }
  return undefined;
}

function deleteCookie(name: string) {
  try {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
  } catch (e) {
    console.warn("Failed to delete cookie:", e);
  }
}

/** ---------- Public configuration ---------- */

// API base can come from prop, URL, window config, env, LS
function resolveApiBase(prop?: string) {
  return (
    prop ||
    readURL("api_base") ||
    readWindow(["API_BASE"]) ||
    readVite(["VITE_API_URL", "REACT_APP_API_URL", "API_BASE"]) ||
    readLS("api_base") ||
    "https://api.texef.com"
  );
}

// TENANT: window.__CHATWIDGET_CONFIG__.TENANT_ID or fallback
function resolveTenantId(): string {
  return readWindow(["TENANT_ID"]) || "tenant_d9368868"; 
}

const API_BASE = resolveApiBase();
const DEFAULT_CONV_ID = "";
const DEFAULT_TENANT_ID = resolveTenantId();

const CHAT_DASHBOARD_URL = "";
const HELP_DOCS_URL =
  readVite([
    "VITE_HELP_DOCS_URL",
    "REACT_APP_HELP_DOCS_URL",
    "HELP_DOCS_URL",
  ]) || "";

const SUPPORT_EMAIL_URL =
  readVite([
    "VITE_SUPPORT_EMAIL_URL",
    "REACT_APP_SUPPORT_EMAIL_URL",
    "SUPPORT_EMAIL_URL",
  ]) || "";
const SUPPORT_EMAIL_TO =
  readVite([
    "VITE_SUPPORT_EMAIL_TO",
    "REACT_APP_SUPPORT_EMAIL_TO",
    "SUPPORT_EMAIL_TO",
  ]) || "support@gmail.com";
const SUPPORT_EMAIL_SUBJECT =
  readVite([
    "VITE_SUPPORT_EMAIL_SUBJECT",
    "REACT_APP_SUPPORT_EMAIL_SUBJECT",
    "SUPPORT_EMAIL_SUBJECT",
  ]) || "Support ";
const SUPPORT_EMAIL_BODY =
  readVite([
    "VITE_SUPPORT_EMAIL_BODY",
    "REACT_APP_SUPPORT_EMAIL_BODY",
    "SUPPORT_EMAIL_BODY",
  ]) || "";

/** ---------- Utilities ---------- */
const uid = () => Math.random().toString(36).slice(2, 10);
function debounce<F extends (...args: any[]) => void>(
  fn: F,
  delay = 300
): (...args: Parameters<F>) => void {
  let t: number | undefined;
  return (...args: Parameters<F>) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), delay);
  };
}
function gmailComposeUrl(
  to: string,
  subject?: string,
  body?: string,
  accountIndex = 0
): string {
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

  const K = [
    "talk to agent",
    "talk to human",
    "connect agent",
    "connect with team",
    "live support",
    "customer care",
    "call me",
    "speak to person",
    "need human",
    "escalate",
    "not helpful",
    "contact support",
    "help me person",
    "transfer to agent",
  ];
  return K.some((k) => t.includes(k));
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

async function listMessages(
  apiBase: string,
  opts: { conversation_id: string; sender?: string; limit?: number }
) {
  const url = new URL(joinUrl(apiBase, "/api/messages"));
  url.searchParams.set("conversation_id", opts.conversation_id);
  if (opts.sender) url.searchParams.set("sender", opts.sender);
  if (opts.limit) url.searchParams.set("limit", String(opts.limit));

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    if (res.status === 404) {
      console.info(
        "[messages] no history yet for conversation_id=",
        opts.conversation_id
      );
      return [] as RawMessage[];
    }
    throw new Error(`GET ${url.toString()} failed: ${res.status}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? (data as RawMessage[]) : [];
}

function normalize(raw: RawMessage): ChatMessage {
  const txt = raw.text ?? raw.message ?? raw.reply ?? "";
  const s = (raw.sender || "").toLowerCase();
  const role: ChatRole =
    s === "user"
      ? "user"
      : s === "agent"
      ? "agent"
      : s === "system"
      ? "system"
      : "bot";
  const ts = raw.created_at ? new Date(raw.created_at).getTime() : Date.now();
  return { id: raw.id, role, text: txt, ts };
}

/** ---------- Linkify ---------- */
const URL_RE = /((https?:\/\/)[^\s<>"')\]]+)/gi;
function LinkifiedText({ text, role }: { text: string; role: ChatRole }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    const url = m[1];
    const start = m.index;
    if (start > last) parts.push(text.slice(last, start));
    const isUser = role === "user";
    const linkClass = isUser
      ? "chat-bubble__link chat-bubble__link--user"
      : "chat-bubble__link chat-bubble__link--bot";
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
  return <span className="chat-bubble__text">{parts}</span>;
}

/** ---------- AI Search ---------- */
type SearchResult = {
  id: string;
  title: string;
  snippet?: string;
  url?: string;
  score?: number;
};
type AiSearchResponse = { answer_markdown?: string; citations?: unknown[] };

const SEARCH_MAX_RESULTS = 5;
const SEARCH_PATHS = ["/api/ai-search", "/api/ai-search/"];

const TITLE_KEYS = ["title", "name", "heading", "documentTitle"];
const SNIPPET_KEYS = [
  "snippet",
  "summary",
  "excerpt",
  "text",
  "content",
  "description",
];
const URL_KEYS = ["url", "link", "href", "source", "src"];
const SCORE_KEYS = ["score", "relevance", "rank", "confidence"];

const isStr = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

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

function mapCitations(
  cites: unknown,
  max = SEARCH_MAX_RESULTS
): SearchResult[] {
  if (!Array.isArray(cites)) return [];
  const out: SearchResult[] = [];
  const seen = new Set<string>();

  cites.forEach((row, i) => {
    if (!row || typeof row !== "object") return;
    const r = row as Record<string, unknown>;

    const url = validHttpUrl(
      pickDeep(r, URL_KEYS) as string | undefined
    );
    const scoreRaw = pickDeep(r, SCORE_KEYS);
    const score = isNum(scoreRaw)
      ? scoreRaw
      : isStr(scoreRaw) && Number.isFinite(Number(scoreRaw))
      ? Number(scoreRaw)
      : undefined;

    let title = pickDeep(r, TITLE_KEYS) as string | undefined;
    if (!isStr(title)) {
      title = url
        ? (() => {
            try {
              return new URL(url!).hostname;
            } catch {
              return undefined;
            }
          })()
        : undefined;
    }
    if (!title) title = `Untitled ${i + 1}`;

    let snippet = pickDeep(r, SNIPPET_KEYS) as string | undefined;
    snippet = stripHtml(snippet);

    const id = String(
      (r as any)?.id ?? (r as any)?._id ?? (r as any)?.uuid ?? url ?? `${i}`
    );

    const dedupeKey = url ?? `${title}|${snippet ?? ""}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    out.push({ id, title, snippet, url, score });
  });

  out.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  return out.slice(0, max);
}

async function aiSearch(
  apiBase: string,
  query: string,
  maxResults = SEARCH_MAX_RESULTS
): Promise<{ answer?: string; results: SearchResult[] }> {
  let lastErr: any;
  for (const path of SEARCH_PATHS) {
    try {
      const url = apiBase.replace(/\/+$/, "") + path;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query, max_results: maxResults }),
      });
      const text = await res.text();
      if (!res.ok)
        throw new Error(
          `HTTP ${res.status} ${res.statusText} — ${text.slice(
            0,
            200
          )}`
        );
      let data: AiSearchResponse | any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Non-JSON response: ${text.slice(0, 200)}…`);
      }

      const answer =
        typeof data?.answer_markdown === "string"
          ? data.answer_markdown
          : undefined;
      const raw = Array.isArray((data as any)?.citations)
        ? (data as any).citations
        : Array.isArray((data as any)?.results)
        ? (data as any).results
        : Array.isArray((data as any)?.data)
        ? (data as any).data
        : Array.isArray((data as any)?.items)
        ? (data as any).items
        : Array.isArray(data)
        ? data
        : [];
      const results = mapCitations(raw, maxResults);
      return { answer, results };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** ---------- Support connect ---------- */
async function notifySupport(
  apiBase: string,
  payload: { conversation_id?: string; action: string; reason?: string }
) {
  const url = joinUrl(apiBase, "/support/connect");
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** ---------- Send to agent ---------- */
async function sendToAgent(
  apiBase: string,
  payload: { conversation_id: string; text: string; client_id?: string }
) {
  try {
    const r = await fetch(joinUrl(apiBase, "/agent/messages"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (r.ok) return true;
  } catch (err) {
    console.warn("sendToAgent /agent/messages failed", err);
  }

  try {
    const r = await fetch(joinUrl(apiBase, "/messages"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
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
    user: "chat-bubble chat-bubble--user", // right
    bot: "chat-bubble chat-bubble--bot", // left
    agent: "chat-bubble chat-bubble--agent", // left
    system: "chat-bubble chat-bubble--system", // left
  };

  const alignClass =
    role === "user"
      ? "chat-bubble-row chat-bubble-row--right"
      : "chat-bubble-row";

  return (
    <div className={alignClass}>
      <div className={classesByRole[role]}>
        <LinkifiedText role={role} text={text} />
      </div>
    </div>
  );
}

/** ---------- Header: Mia bot ---------- */
function Header({
  agentMode,
  agentJoining,
  agentName,
  botName,
  botLogo
}: {
  agentMode: boolean;
  agentJoining: boolean;
  agentName: string | null;
  botName: string;
  botLogo: string | null;
  
}) {
  let dotClass = "chat-header__status-dot";

  if (!agentMode && !agentJoining) {
    dotClass += " chat-header__status-dot--online";
  } else if (agentJoining) {
    dotClass += " chat-header__status-dot--pending";
  } else {
    dotClass += " chat-header__status-dot--online";
  }

  return (
    <div className="chat-header">
      <div className="chat-header__body">
        <div className="chat-header__avatars">
          <div className="chat-header__avatar">
          {agentMode
          ? (agentName?.charAt(0).toUpperCase() || "A")
         : (
             botLogo 
                 ? <img src={botLogo} className="avatar-img" /> 
                 : botName.charAt(0).toUpperCase()
       )}
      </div>
        </div>

        <div className="chat-header__info">
          <div className="chat-header__title">
            {agentMode && agentName ? agentName : botName}
          </div>
          <div className="chat-header__subtitle">
            <span className={dotClass} />
            Ask me anything about O! Millionaire
          </div>
        </div>
      </div>
    </div>
  );
}

/** ---------- Quick card ---------- */
// function QuickCard({ onSearch }: { onSearch: () => void }) {
//   return (
//     <div className="quick-card">
//       <div className="quick-card__text">
//         Ask me anything about your account, tickets, or support.
//       </div>
//     </div>
//   );
// }

/** ---------- Composer ---------- */
function Composer({
  onSend,
  agentMode,
}: {
  onSend: (text: string) => void | Promise<void>;
  agentMode: boolean;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;

    setSending(true);
    setText("");

    await onSend(t);
    setSending(false);
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (
    e
  ) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="composer">
      <div className="composer__inner">
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={agentMode ? "Message the agent…" : "Type a message…"}
          className="composer__textarea"
        />
        <button
          onClick={() => void send()}
          disabled={sending}
          className={
            "composer__send-btn" +
            (sending ? " composer__send-btn--disabled" : "")
          }
        >
          <Send className="composer__send-icon" />
        </button>
      </div>
      <div className="composer__footer">
        <Bot className="composer__footer-icon" /> Powered by the Texef
      </div>
    </div>
  );
}

/** ---------- Support Chips (used in HelpdeskPane) ---------- */
type SupportItem = { id: "connect" | "live" | "email" | "docs"; label: string };
function SupportChips({
  onTap,
}: {
  onTap: (item: SupportItem) => void | Promise<void>;
}) {
  const items: SupportItem[] = [
    { id: "connect", label: "Connect with Team" },
    { id: "live", label: "Live Support" },
    { id: "email", label: "Email Us" },
    { id: "docs", label: "Help Docs" },
  ];
  return (
    <div className="chips">
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => void onTap(it)}
          className="chips__item"
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** ---------- Helpdesk Pane (kept for future; not linked from UI) ---------- */
function HelpdeskPane({ apiBase, convId }: { apiBase: string; convId?: string }) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [answer, setAnswer] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<number>(-1);
  const [docsOpen, setDocsOpen] = useState(false);
  const [docsUrl, setDocsUrl] = useState<string>(HELP_DOCS_URL);
  

  type FlashMsg = {
    id: string;
    text: string;
    tone: "success" | "info" | "error";
  };
  const [flash, setFlash] = useState<FlashMsg[]>([]);
  const pushFlash = (text: string, tone: FlashMsg["tone"] = "success") =>
    setFlash((f) => [...f, { id: uid(), text, tone }]);
  const removeFlash = (id: string) =>
    setFlash((f) => f.filter((x) => x.id !== id));
  const toneCls = (t: FlashMsg["tone"]) =>
    t === "success"
      ? "flash flash--success"
      : t === "error"
      ? "flash flash--error"
      : "flash flash--info";

  const handleSupportTap = async (item: SupportItem) => {
    if (item.id === "docs") {
      if (HELP_DOCS_URL) {
        setDocsUrl(HELP_DOCS_URL);
        setDocsOpen(true);
      } else {
        await notifySupport(apiBase, {
          conversation_id: convId,
          action: "open_docs_missing_url",
        });
        pushFlash(
          "Help docs URL is not configured. Please contact support.",
          "error"
        );
      }
      return;
    }
    if (item.id === "email") {
      if (SUPPORT_EMAIL_URL) {
        if (SUPPORT_EMAIL_URL.startsWith("mailto:"))
          window.location.href = SUPPORT_EMAIL_URL;
        else
          window.open(
            SUPPORT_EMAIL_URL,
            OPEN_LINK_IN_NEW_TAB ? "_blank" : "_self",
            "noopener,noreferrer"
          );
      } else {
        const subject =
          SUPPORT_EMAIL_SUBJECT?.trim()?.length
            ? `${SUPPORT_EMAIL_SUBJECT} (${convId || "no-conv-id"})`
            : `Support request (${convId || "no-conv-id"})`;
        const body =
          SUPPORT_EMAIL_BODY?.trim()?.length
            ? `${SUPPORT_EMAIL_BODY}\n\nConversation ID: ${
                convId || "-"
              }`
            : `\n`;
        const gmailHref = gmailComposeUrl(
          SUPPORT_EMAIL_TO,
          subject,
          body,
          0
        );
        window.open(gmailHref, "_blank", "noopener,noreferrer");
      }
      await notifySupport(apiBase, {
        conversation_id: convId,
        action: "email",
        reason: "chip_click",
      });
      pushFlash(
        "Email composer opened — our team will follow up shortly.",
        "info"
      );
      return;
    }
    if (item.id === "live") {
      const dest = (CHAT_DASHBOARD_URL || "/chat")
        .replace("{convId}", encodeURIComponent(convId || ""))
        .replace("{conversation_id}", encodeURIComponent(convId || ""))
        .replace("{tenantId}", encodeURIComponent(DEFAULT_TENANT_ID || ""));
      window.location.assign(dest);
      void notifySupport(apiBase, {
        conversation_id: convId,
        action: "live",
        reason: "chip_click",
      });
      return;
    }
    if (item.id === "connect") {
      await notifySupport(apiBase, {
        conversation_id: convId,
        action: "connect",
        reason: "chip_click",
      });
      pushFlash("We're on it! A human will hop in shortly", "success");
      return;
    }
    await notifySupport(apiBase, {
      conversation_id: convId,
      action: item.id,
      reason: "chip_click",
    });
    pushFlash("We'll connect you with our team shortly.", "success");
  };

  const doSearch = async (query: string) => {
    if (!query.trim()) {
      setResults([]);
      setAnswer(undefined);
      setError(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const out = await aiSearch(apiBase, query.trim(), SEARCH_MAX_RESULTS);
      setAnswer(out.answer);
      setResults(out.results);
    } catch (e: any) {
      setError(e?.message || "Search failed.");
      setAnswer(undefined);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };
  const debounced = useRef(
    debounce((value: string) => {
      void doSearch(value);
    }, 350)
  ).current;
  useEffect(() => {
    debounced(q);
  }, [q, debounced]);

  const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (!results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[active >= 0 ? active : 0];
      if (pick?.url)
        window.open(
          pick.url,
          OPEN_LINK_IN_NEW_TAB ? "_blank" : "_self",
          "noopener,noreferrer"
        );
    }
  };

  return (
    <div className="helpdesk">
      {/* kept minimal for now */}
      {loading && <div className="helpdesk__status">Searching…</div>}
      {error && <div className="helpdesk__error">{error}</div>}
      {!loading && !error && answer && (
        <div className="helpdesk__answer">{answer}</div>
      )}
    </div>
  );
}

/** ---------- Scrolling helpers ---------- */
function isNearBottom(el: HTMLDivElement, threshold = 64) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

/** ---------- Tenants ---------- */
function getResolvedTenantId() {
  return resolveTenantId();
}

/** ---------- Chat Pane (bot + messages) ---------- */
function ChatPane({
  messages,
  onSend,
  goHelpdesk,
  agentMode,
  botTyping,

  // ⭐ ADD THESE
  showEscalationForm,
  setShowEscalationForm,
  emailInput,
  setEmailInput,
  emailLoading,
  setEmailLoading,
  convId,
  apiBase,
  add,
  token, 
}: {
  messages: ChatMessage[];
  onSend: (t: string) => Promise<void> | void;
  goHelpdesk: () => void;
  agentMode: boolean;
  botTyping: boolean;

  showEscalationForm: boolean;
  setShowEscalationForm: any;
  emailInput: string;
  setEmailInput: any;
  emailLoading: boolean;
  setEmailLoading: any;
  convId: string;
  apiBase: string;
  add: any;
   token: string | null; 
})
 {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
  const el = scrollerRef.current;
  if (!el) return;

  requestAnimationFrame(() => {
    el.scrollTo({
      top: el.scrollHeight,
      behavior: "smooth",
    });
  });
}, [messages]);
  // const [hasUnseen, setHasUnseen] = useState(false);

  // useEffect(() => {
  //   const el = scrollerRef.current;
  //   if (!el) return;
  //   const onScroll = () => {
  //     const atBottom = isNearBottom(el);
  //     if (atBottom) setHasUnseen(false);
  //   };
  //   el.addEventListener("scroll", onScroll, { passive: true });
  //   onScroll();
  //   return () => el.removeEventListener("scroll", onScroll);
  // }, []);

  // const prevLen = useRef(0);
  // useEffect(() => {
  //   const el = scrollerRef.current;
  //   if (!el) return;
  //   const wasNear = isNearBottom(el);
  //   const gotNew = messages.length > prevLen.current;
  //   prevLen.current = messages.length;
  //   if (gotNew) {
  //     if (wasNear)
  //       el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  //     else setHasUnseen(true);
  //   }
  // }, [messages]);

  // const jumpToBottom = () => {
  //   const el = scrollerRef.current;
  //   if (!el) return;
  //   el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  //   setHasUnseen(false);
  // };

  return (
    <div className="chat-main">
      <div ref={scrollerRef} className="chat-main__scroll">
        <div className="chat-main__quick">
        </div>

        {/* {messages.map((m) => (
          <Bubble key={m.id + String(m.ts)} role={m.role} text={m.text} />
        ))} */}

       {messages.map((m) => {
  const lower = m.text?.toLowerCase() || "";

  const isIdentityRequestMsg =
    m.role === "system" &&
    lower.includes("before i connect you with an agent");

  return (
    <div key={m.id + String(m.ts)}>
      <Bubble role={m.role} text={m.text} />

      {isIdentityRequestMsg && showEscalationForm && (
        <div className="escalation-form">
          <h3>Please enter your details</h3>
          <p>You may provide your <b>name</b>,<b>phone number</b>.</p>

          <input
            type="text"
            className="escalation-input"
            placeholder="Name,or Phone"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
          />

          <button
            className="escalation-submit"
            disabled={emailLoading}
            onClick={async () => {
            const input = emailInput.trim();

if (!input) {
  alert("Please enter name or phone number.");
  return;
}

// ❌ Explicitly block email
if (/@/.test(input)) {
  alert("Email is not supported. Please enter name or phone number.");
  return;
}

// ✅ Global phone (all countries)
const isPhone = /^[+]?[\d\s\-()]{6,}$/.test(input);

// ✅ Name
const isName = /^[A-Za-z\s]{2,}$/.test(input);

if (!isPhone && !isName) {
  alert("Please enter a valid name or phone number.");
  return;
}


              setEmailLoading(true);

              try {
                const res = await fetch(joinUrl(apiBase, "/api/identity/submit"), {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: token ? "Bearer " + token : ""
                  },
                  body: JSON.stringify({
                    conversation_id: convId,
                    text: input, // ⭐ correct key
                  })
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.ok) {
                  add("system", "Thank you! Your details have been submitted successfully. An agent is now ready to assist you.");
                  setShowEscalationForm(false);   // close only on success
                  setCookie("escalation_form_shown", "true");

                } else {
                  add("system", data.message || "Unable to submit details.");
                  setShowEscalationForm(true);     // keep form open on fail
                }

              } catch (err) {
                add("system", "Network error submitting details, chat continues.");
                setShowEscalationForm(true);
              }

              setEmailLoading(false);
            }}
          >
            {emailLoading ? "Submitting…" : "Submit"}
          </button>
        </div>
      )}
    </div>
  );
})}

        

        {botTyping && (
          <div className="chat-bubble-row">
            <div className="chat-bubble chat-bubble--bot">Typing…</div>
          </div>
        )}
      </div>
      <Composer onSend={onSend} agentMode={agentMode} />
    </div>
  );
}

/** ---------- Panel (full widget) ---------- */
function Panel({
  onClose,
  apiBase,
  initialConvId,
  storageKey = "conv_id",
  autoCreate = true,
  enableWebSocket = true,
}: {
  onClose: () => void;
  apiBase: string;
  initialConvId?: string;
  storageKey?: string;
  autoCreate?: boolean;
  enableWebSocket?: boolean;
}) {
  const [showEscalationForm, setShowEscalationForm] = useState(true);
  // const hasShownEscalation = localStorage.getItem("escalation_form_shown") === "true";
  const hasShownEscalation = getCookie("escalation_form_shown") === "true";

  const botName = readWindow(["BOT_NAME"]) || "Mia";
  const botLogo = readWindow(["LOGO_URL"]) || null;


  const [emailInput, setEmailInput] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [agentMode, setAgentMode] = useState(false);
  const [agentJoining, setAgentJoining] = useState(false);
  const [agentName, setAgentName] = useState<string | null>(null);

  const [botTyping, setBotTyping] = useState(false);

  const botPendingSinceRef = useRef<number | null>(null);
  const botTimeoutTimerRef = useRef<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const wsHeartbeatRef = useRef<number | null>(null);
  const wsReconnectAttempts = useRef(0);

  const [wsFailed, setWsFailed] = useState(false);
  const initCalledRef = useRef(false);

  // const [token, setToken] = useState<string | null>(() =>
  //   typeof localStorage !== "undefined"
  //     ? localStorage.getItem("chat_token")
  //     : null
  // );
  const [token, setToken] = useState<string | null>(() =>
  typeof document !== "undefined" ? getCookie("chat_token") || null : null
);

  // const [convId, setConvId] = useState<string>(() => DEFAULT_CONV_ID);
  const [convId, setConvId] = useState<string>(() => {
  return getCookie("conv_id") || DEFAULT_CONV_ID;
});


  useEffect(() => {
    try {
      if (convId) setCookie(storageKey, convId);
    } catch {}
  }, [convId, storageKey]);

  const initWidget = async () => {
    try {
      const resolvedTenantId = getResolvedTenantId();

      if (!resolvedTenantId || resolvedTenantId.trim() === "") {
        console.error(
          "❌ initWidget: TENANT_ID missing in window.__CHATWIDGET_CONFIG__"
        );
        return;
      }

      const url = joinUrl(apiBase, "/api/widget/init");
      const payload = { tenant_id: resolvedTenantId };

      dbg("[⚙️ Initializing Widget] POST", url, "payload:", payload);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
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
          // localStorage.setItem(storageKey, data.conversation_id);
           setCookie(storageKey, data.conversation_id);
        } catch {}
      }

      const t = data?.token || data?.access_token || null;
      if (t) {
        try {
          // localStorage.setItem("chat_token", t);
          setCookie("chat_token", t);
        } catch {}
        setToken(t);
      } else {
        console.warn("⚠️ No token returned from /api/widget/init");
        setToken(null);
      }
    } catch (err) {
      console.error("❌ Error during widget init:", err);
    }
  };

  // useEffect(() => {
  //   (async () => {
  //     if (!autoCreate) return;

  //     if (initCalledRef.current) {
  //       dbg("[INIT] Skipping duplicate initWidget");
  //       return;
  //     }
  //     initCalledRef.current = true;

  //     await initWidget();
  //   })();
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, []);

useEffect(() => {
  (async () => {
    if (!autoCreate) return;

    // ⭐ Cookie-ൽ conversation already ഉണ്ടെങ്കിൽ → reuse
    if (convId) {
      dbg("♻️ Existing conversation restored:", convId);
      return;
    }

    if (initCalledRef.current) return;
    initCalledRef.current = true;

    await initWidget();
  })();
}, [convId]);

  useEffect(() => {
    if (!convId || convId === DEFAULT_CONV_ID) return;
    let cancelled = false;
    (async () => {
      try {
        setLoadingHistory(true);
        const raw = await listMessages(apiBase, {
          conversation_id: convId,
          limit: 500,
        });
        if (cancelled) return;
        const mapped = raw.map(normalize);
        mapped.sort((a, b) => a.ts - b.ts);
        setMessages(mapped);
      } catch (e) {
        console.warn("Failed to load history:", e);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, convId]);

  const add = (role: ChatRole, text: string, id?: string) =>
  setMessages((prev) => {
    const trimmed = (text || "").trim();
    if (!trimmed) return prev;

    // 1) same id already there → skip
    if (id && prev.some((m) => m.id === id)) return prev;

    const last = prev[prev.length - 1];

    // 2) exact same text + same role → skip
    if (last && last.text === trimmed && last.role === role) {
      return prev;
    }

    // 3) special case:
    //    last user "hellow" + new agent "hellow" → skip agent echo
    if (
      last &&
      last.role === "user" &&
      role === "agent" &&
      last.text === trimmed
    ) {
      console.log(
        "[Widget] Skipping agent message that exactly matches last user text:",
        trimmed
      );
      return prev;
    }

    // 4) system escalation detection
    // if (role === "system") {
    //   const lower = trimmed.toLowerCase();
    //   if (
    //     lower.includes("your conversation has been escalated") &&
    //     lower.includes("support team")
    //   ) {
    //     setAgentMode(true);
    //     setAgentJoining(true);
    //   }
    // }
//     if (role === "system") {
//         const lower = trimmed.toLowerCase();
//         if (
//           lower.includes("your conversation has been escalated") &&
//           lower.includes("support team")
//   ) {
//     setAgentMode(true);
//     setAgentJoining(true);

//     // ⭐ Escalation form show ചെയ്യണം
//     setShowEscalationForm(true);
//   }
// }
// if (role === "system") {
//   const lower = trimmed.toLowerCase();
//   if (
//     lower.includes("before i connect you with an agent") 
//   ) {
//     setAgentMode(true);
//     setAgentJoining(true);

//     // ⭐ Show only ONCE per user
//     if (!hasShownEscalation) {
//       setShowEscalationForm(true);
//       // localStorage.setItem("escalation_form_shown", "true");
//       setCookie("escalation_form_shown", "true");

//     }
//   }
// }
if (role === "system") {
  const lower = trimmed.toLowerCase();

  // Identity request prompt from backend
  if (lower.includes("before i connect you with an agent")) {
    
    console.log("🔥 SYSTEM → Identity request detected");
    setAgentMode(true);
    setAgentJoining(true);

    if (!hasShownEscalation) {
      setShowEscalationForm(true);
      setCookie("escalation_form_shown", "true");
    }

    console.log("📨 Calling /identity/request …");

    // AUTO-trigger identity request API
    fetch(joinUrl(apiBase, "/api/identity/request"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: token ? `Bearer ${token}` : "",
      },
      body: JSON.stringify({ conversation_id: convId }),
    })
      .then(() => console.log("✅ /identity/request OK"))
      .catch((err) =>
        console.warn("❌ Error calling /identity/request:", err)
      );
  }
}


    const next = [
      ...prev,
      { id: id || uid(), role, text: trimmed, ts: Date.now() },
    ];
    next.sort((a, b) => a.ts - b.ts);
    return next;
  });
  async function escalateToAgent(
    reason: "bot_timeout" | "network_error" | "empty_reply" | "user_intent"
  ) {
    if (agentMode || agentJoining) return;

    setBotTyping(false);

    setAgentJoining(true);
    setAgentMode(true);

    void notifySupport(apiBase, {
      conversation_id: convId,
      action: reason,
      reason,
    });
  }

  function startBotTimeout() {
    if (botTimeoutTimerRef.current)
      window.clearTimeout(botTimeoutTimerRef.current);
    botPendingSinceRef.current = Date.now();
    botTimeoutTimerRef.current = window.setTimeout(() => {
      void escalateToAgent("bot_timeout");
    }, BOT_REPLY_TIMEOUT_MS);
  }
  function clearBotTimeout() {
    if (botTimeoutTimerRef.current)
      window.clearTimeout(botTimeoutTimerRef.current);
    botTimeoutTimerRef.current = null;
    botPendingSinceRef.current = null;
  }

  const onSend = async (text: string) => {
  add("user", text);

  // 1) user human ചോദിച്ചാൽ escalation trigger ചെയ്യാം,
  //    പക്ഷേ message backend-ലേക്കും പോകണം, അതിനാൽ return ചെയ്യണ്ട.
  if (!agentMode && isAgentIntent(text)) {
    await escalateToAgent("user_intent");
    // INTENT note ആയി /support/connect പോകും, പക്ഷേ താഴെ /api/messages call തുടരും
  }

  try {
    startBotTimeout();
    setBotTyping(true);

    // const tkn = token || localStorage.getItem("chat_token");
    const tkn = token || getCookie("chat_token");
    const senderId = getSenderId();
    const conversationId = convId || DEFAULT_CONV_ID;

    // 👇 എല്ലായ്പ്പോഴും /api/messages മാത്രം
    const payload: any = {
      conversation_id: conversationId,
      sender_id: senderId,
      text,
    };

    // Escalation കഴിഞ്ഞ ശേഷം backend-നു hint തരണമെങ്കിൽ:
    // (നിന്റെ /api/messages handler-ൽ target=='agent' കണ്ടാൽ
    //   agent WS-ലേക്ക് forward ചെയ്യാം)
    if (agentMode) {
      payload.target = "agent";
    }

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
    setBotTyping(false);

    if (!res.ok) {
      add("bot", "Sorry, there was a network issue.");
      if (ESCALATE_ON_NETWORK_ERROR)
        await escalateToAgent("network_error");
      return;
    }

    if (data?.conversation_id && data.conversation_id !== convId) {
      setConvId(data.conversation_id);
      try {
        // localStorage.setItem(storageKey, data.conversation_id);
        setCookie(storageKey, data.conversation_id);

      } catch {}
    }

    const reply =
      data?.text ||
      data?.message ||
      data?.reply ||
      data?.payload?.text ||
      "";

    const botId =
      data?.id || data?.message?.id || data?.payload?.id || undefined;

    const lowerReply = (reply || "").toLowerCase();
    const isHttpEscalation =
    lowerReply.includes("before i connect you with an agent");


    // Escalation message handle
    if (isHttpEscalation) {
        setShowEscalationForm(true);
      // WS work ചെയ്‌താൽ system message WS വഴി വരട്ടെ
      // (ഇപ്പോൾ wsFailed state ഇല്ലെങ്കിൽ skip)
      dbg(
        "[onSend] Escalation reply from HTTP – skipping extra bot bubble, WS/system message will handle UI"
      );
      return;
    }

    if (!reply || reply.trim() === "…") {
      add("bot", "", botId);
      if (ESCALATE_ON_EMPTY_REPLY)
        await escalateToAgent("empty_reply");
    } else {
      add("bot", reply, botId);
      const lower = reply.toLowerCase();
      if (BOT_FALLBACK_PATTERNS.some((p) => lower.includes(p))) {
        await escalateToAgent("empty_reply");
      }
    }
  } catch (err) {
    clearBotTimeout();
    setBotTyping(false);
    console.error("❌ /api/messages error:", err);
    add("bot", "Network error. Please try again.");
    if (ESCALATE_ON_NETWORK_ERROR)
      await escalateToAgent("network_error");
  }
};

  // function getSenderId(): string {
  //   try {
  //     const key = "chat_sender_id";
  //     let senderId = localStorage.getItem(key);
  //     if (!senderId) {
  //       senderId = "user_" + Math.random().toString(36).slice(2, 10);
  //       localStorage.setItem(key, senderId);
  //     }
  //     return senderId;
  //   } catch {
  //     return "user_" + Math.random().toString(36).slice(2, 10);
  //   }
  // }
  function getSenderId(): string {
  try {
    const key = "chat_sender_id";
    let senderId = getCookie(key);
    if (!senderId) {
      senderId = "user_" + Math.random().toString(36).slice(2, 10);
      setCookie(key, senderId);
    }
    return senderId;
  } catch {
    return "user_" + Math.random().toString(36).slice(2, 10);
  }
}


  useEffect(() => {
    if (!enableWebSocket || wsFailed) {
      dbg("[WS] Disabled or previously failed, skipping WebSocket setup");
      return;
    }

    if (!convId || convId === DEFAULT_CONV_ID) return;

    // const widgetToken = token || localStorage.getItem("chat_token");
    const widgetToken = token || getCookie("chat_token");

    if (!widgetToken) {
      dbg("[WS] waiting for token…");
      return;
    }

    let cancelled = false;
    const wsOrigin = toWsUrl(apiBase);

    dbg("[WS] origin:", wsOrigin);
    dbg("[WS] convId:", convId);
    dbg("[WS] token:", show(widgetToken));

    const url = `${wsOrigin}/ws/conversations/${encodeURIComponent(
      convId
    )}?token=${encodeURIComponent(widgetToken)}`;
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
          if (wsHeartbeatRef.current)
            window.clearInterval(wsHeartbeatRef.current);
          wsHeartbeatRef.current = window.setInterval(() => {
            try {
              ws.send(JSON.stringify({ type: "ping", at: Date.now() }));
            } catch {}
          }, 20000);
        };

        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            

            if (msg?.id && seenMessages.has(msg.id)) {
              dbg("⚠️ Duplicate WS message skipped:", msg.id);
              return;
            }
            if (msg?.id) seenMessages.add(msg.id);

            // 1) agent assigned
            if (msg?.type === "agent.assigned") {
              setAgentName(msg.name || "Agent");
              setAgentJoining(false);
              setAgentMode(true);
              return;
            }

            // 2) single message
            if (msg?.type === "message") {
              if (msg.scope === "tenant") return;

              const rawSender = (msg.sender || "").toLowerCase();
              let role: ChatRole;

              if (!agentMode && rawSender === "agent") {
                role = "bot";
              } else if (rawSender === "user") {
                role = "user";
              } else if (rawSender === "agent") {
                role = "agent";
              } else if (rawSender === "system") {
                role = "system";
              } else {
                role = "bot";
              }

              if (msg.text?.trim()) {
                add(role, msg.text, msg.id);
                dbg("✅ WS message added:", msg);
              }
              return;
            }

            // 3) legacy message.created
            if (msg?.type === "message.created" && msg?.message) {
              const m = msg.message;
              const sender = (m.sender || "").toLowerCase();
              let role: ChatRole;

              if (!agentMode && sender === "agent") {
                role = "bot";
              } else if (sender === "user") {
                role = "user";
              } else if (sender === "agent") {
                role = "agent";
              } else if (sender === "system") {
                role = "system";
              } else {
                role = "bot";
              }

              if (m.text?.trim()) add(role, m.text, m.id);
              return;
            }

            // 4) messages array
            if (Array.isArray(msg?.messages)) {
              for (const m of msg.messages) {
                const sender = (m.sender || "").toLowerCase();
                let role: ChatRole;

                if (!agentMode && sender === "agent") {
                  role = "bot";
                } else if (sender === "user") {
                  role = "user";
                } else if (sender === "agent") {
                  role = "agent";
                } else if (sender === "system") {
                  role = "system";
                } else {
                  role = "bot";
                }

                if (m.text?.trim()) add(role, m.text, m.id);
              }
              return;
            }
          } catch (err) {
            console.warn("WS message parse error:", err);
          }
        };

        ws.onclose = (evt) => {
          dbg("🔌 WebSocket closed:", evt.code, evt.reason);

          if ([4001, 4401, 4403, 1008].includes(evt.code)) {
            try {
              // localStorage.removeItem("chat_token");
              deleteCookie("chat_token");

            } catch {}
            setToken(null);
            setWsFailed(true);
            return;
          }

          if (evt.code === 1006) {
            setWsFailed(true);
            return;
          }

          setWsFailed(true);
        };

        ws.onerror = (err) => {
          dbg("⚠️ WebSocket error:", err);
          setWsFailed(true);
        };
      } catch (e) {
        console.warn("WS init failed:", e);
        setWsFailed(true);
      }
    };

    openWs();

    return () => {
      cancelled = true;
      if (wsHeartbeatRef.current) {
        window.clearInterval(wsHeartbeatRef.current);
        wsHeartbeatRef.current = null;
      }
      try {
        wsRef.current?.close();
      } catch {}
      wsRef.current = null;
    };
  }, [apiBase, convId, enableWebSocket, token, wsFailed]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ type: "spring", damping: 20, stiffness: 240 }}
      className="chat-panel"
    >
      <Header
        agentMode={agentMode}
        agentJoining={agentJoining}
        agentName={agentName}
        botName={botName}
        botLogo={botLogo}
      />
      <div className="chat-panel__body">

      {/* {showEscalationForm && (
  <div className="escalation-form">
    <h3>Please enter your email</h3>
    <p>Our support team will reach out shortly.</p>

    <input
      type="email"
      className="escalation-input"
      placeholder="Enter your email"
      value={emailInput}
      onChange={(e) => setEmailInput(e.target.value)}
    />

    <button
      className="escalation-submit"
      disabled={emailLoading}
      onClick={async () => {

        if (!emailInput.trim()) {
          alert("Enter your email");
          return;
        }

        setEmailLoading(true);

        try {
          const res = await fetch(joinUrl(apiBase, "/api/escalation/email")
, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversation_id: convId,
              email: emailInput.trim(),
            }),
          });

          if (res.ok) {
            add("system", "Thank you! Our team will contact you.");
          } else {
            add("system", "Email could not be submitted, but chat continues.");
          }
        } catch {
          add("system", "Network error submitting email, chat continues.");
        }

        // ⭐ success ആണോ fail ആണോ → form close
        setShowEscalationForm(false);
        setEmailLoading(false);
      }}
    >
      {emailLoading ? "Submitting…" : "Submit"}
    </button>
  </div>
)} */}

        {loadingHistory && (
          <div className="chat-panel__loading">
            Loading previous messages…
          </div>
        )}
     <ChatPane
  messages={messages}
  onSend={onSend}
  goHelpdesk={() => {}}
  agentMode={agentMode}
  botTyping={botTyping}

  showEscalationForm={showEscalationForm}
  setShowEscalationForm={setShowEscalationForm}
  emailInput={emailInput}
  setEmailInput={setEmailInput}
  emailLoading={emailLoading}
  setEmailLoading={setEmailLoading}
  convId={convId}
  apiBase={apiBase}
  add={add}
  token={token}
/>


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
  const enableWebSocket = props.enableWebSocket ?? true;

  const isInternalRoute = CHAT_DASHBOARD_URL.startsWith("/");
  const isChatPage =
    isInternalRoute &&
    typeof window !== "undefined" &&
    window.location.pathname === CHAT_DASHBOARD_URL;
  // if (isChatPage) return <ChatDashboard />;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="chat-launcher"
        aria-label="Open chat"
      >
  {window.__CHATWIDGET_CONFIG__?.LOGO_URL ? (
   <img
    src={window.__CHATWIDGET_CONFIG__.LOGO_URL}
    alt="Bot"
    className="chat-launcher__img"
    onError={(e) => {
      e.currentTarget.onerror = null;
      e.currentTarget.src = "/default-bot.png";
    }}
  />
) : (
  <Bot className="chat-launcher__icon" />
)}

      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="chat-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="chat-overlay__backdrop"
              onClick={() => setOpen(false)}
            />
            <div
              className="chat-overlay__panel-wrap"
              onClick={(e) => e.stopPropagation()}
            >
              <Panel
                onClose={() => setOpen(false)}
                apiBase={apiBase}
                initialConvId={initialConvId}
                storageKey={storageKey}
                autoCreate={autoCreate}
                enableWebSocket={enableWebSocket}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** ---------- Global init ---------- */
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

if (typeof window !== "undefined") {
  (window as any).ChatWidget = { initChatWidget };
}

// Legacy no-op stubs
function loadConversationHistory(conversation_id: any) {}
function startWebSocket(conversation_id: any, token: any) {}