// src/chat-widget-sdk.ts

// 1) CSS εδώ import ചെയ്യണം – ഇതുകൊണ്ട് distൽ CSS bundle ഉണ്ടാകും
import "./index.css";

import React from "react";
import ReactDOM from "react-dom/client";
import ChatWidgetDemo from "./ChatWidget"; // നിന്റെ main widget component

type InitOptions = {
  apiBase?: string;
  tenantId?: string;
};

function init(options: InitOptions = {}) {
  const rootEl = document.querySelector<HTMLElement>("[data-chat-widget]") 
              || document.getElementById("chat-root");

  if (!rootEl) {
    console.error("[ChatWidgetSDK] root element not found");
    return;
  }

  const apiBase = rootEl.getAttribute("data-api-base") || options.apiBase;
  const tenantId = rootEl.getAttribute("data-tenant-id") || options.tenantId;

  const root = ReactDOM.createRoot(rootEl);
  root.render(
    <React.StrictMode>
      <ChatWidgetDemo
        apiBase={apiBase}
        tenantId={tenantId}
      />
    </React.StrictMode>
  );
}

// browser-ൽ window വഴി access ചെയ്യാൻ
// @ts-ignore
window.ChatWidgetSDK = { init };

export { init };
