// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // SDK lib build
    lib: {
      entry: "src/chat-widget-sdk.tsx", // 👈 നിന്റെ SDK entry
      name: "ChatWidgetSDK",
      fileName: "chat-widget-sdk",
      formats: ["umd", "iife"],
    },
    rollupOptions: {
      // react, react-dom etc external ആക്കാം
      external: ["react", "react-dom"],
      output: {
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
        },
      },
    },
  },
});





// vite.config.ts
// import { defineConfig } from "vite";
// import react from "@vitejs/plugin-react";

// export default defineConfig({
//   plugins: [react()],
//   build: {
//     lib: {
//       entry: "src/sdk.tsx",
//       name: "ChatWidget",
//       // we emit both UMD & IIFE so you can <script> it anywhere
//       formats: ["umd", "iife"],
//       fileName: (format) => `chat-widget-sdk.${format}.js`,
//     },
//     rollupOptions: {
//       // bundle everything (no externals) so host site needs nothing else
//       external: [],
//       output: {
//         inlineDynamicImports: true,
//       },
//     },
//     sourcemap: true,
//     target: "es2019",
//   },
// });
