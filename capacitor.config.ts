import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.herdr.world",
  appName: "Herdr World",
  webDir: "web/dist",
  server: {
    androidScheme: "http",
    cleartext: true,
  },
};

export default config;
