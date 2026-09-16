import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const bridgeTarget = process.env.HERDR_WEB_BRIDGE ?? "http://127.0.0.1:8787";
const bridgeOrigin = new URL(bridgeTarget).origin;

function rewriteBridgeOrigin(proxyReq: { setHeader(name: string, value: string): void }) {
  proxyReq.setHeader("origin", bridgeOrigin);
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: bridgeTarget,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", rewriteBridgeOrigin);
        },
      },
      "/ws": {
        target: bridgeTarget,
        ws: true,
        changeOrigin: true,
        rewriteWsOrigin: true,
        configure(proxy) {
          proxy.on("proxyReqWs", rewriteBridgeOrigin);
        },
      },
    },
  },
});
