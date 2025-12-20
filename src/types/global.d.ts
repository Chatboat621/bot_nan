export {};

declare global {
  interface Window {
    __CHATWIDGET_CONFIG__?: {
      API_BASE?: string;
      TENANT_ID?: string;
      BOT_NAME?: string;
      LOGO_URL?: string;
      DEFAULT_LOGO_URL?: string;
    };
  }
}
