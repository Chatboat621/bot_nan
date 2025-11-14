import React from "react";
import { createRoot } from "react-dom/client";
import ChatWidgetDemo from "./ChatWidget";

export function initChatWidget({
  apiBase, tenantId, containerId="chat-root",
  autoCreate=true, enableWebSocket=true
}: {
  apiBase?: string; tenantId?: string; containerId?: string;
  autoCreate?: boolean; enableWebSocket?: boolean;
} = {}) {
  const el = document.getElementById(containerId);
  if (!el) { console.error(`#${containerId} not found`); return; }

  // data-* fallback (HTML-ൽ നൽകിയാൽ)
  const ds = (el as HTMLElement).dataset || {};
  apiBase ??= ds.apiBase as string | undefined;
  tenantId ??= ds.tenantId as string | undefined;

  createRoot(el).render(
    <React.StrictMode>
      <ChatWidgetDemo
        apiBase={apiBase}
        tenantId={tenantId}
        autoCreate={autoCreate}
        enableWebSocket={enableWebSocket}
      />
    </React.StrictMode>
  );
}

// Global expose + auto-init (data-chat-widget ഉണ്ടെങ്കിൽ)
if (typeof window !== "undefined") {
  (window as any).ChatWidget = { initChatWidget };
  const auto = () => {
    const host = document.querySelector<HTMLElement>("[data-chat-widget]");
    if (!host) return;
    if (!host.id) host.id = "chat-root";
    initChatWidget({
      apiBase: host.dataset.apiBase,
      tenantId: host.dataset.tenantId,
      containerId: host.id,
    });
  };
  document.readyState === "complete" ? auto() : window.addEventListener("load", auto);
}
