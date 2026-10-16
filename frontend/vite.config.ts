import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const base = env.VITE_BASE_PATH ?? "/";
  const sensitiveNames = Object.keys(env).filter(name =>
    /^VITE_.*(?:SERVICE_ROLE|SECRET|DATABASE_PASSWORD|PRIVATE_KEY|ACCESS_TOKEN)/i.test(name),
  );
  const configuredKey = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY;
  const jwtRole = configuredKey?.startsWith("eyJ")
    ? (() => {
        try {
          const payload = configuredKey.split(".")[1];
          return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role;
        } catch {
          return undefined;
        }
      })()
    : undefined;

  if (sensitiveNames.length || configuredKey?.startsWith("sb_secret_") || jwtRole === "service_role") {
    throw new Error("A server-side secret was configured as a VITE_ variable. Remove it; frontend builds accept only a publishable/anon key.");
  }
  if (!base.startsWith("/") || !base.endsWith("/")) {
    throw new Error("VITE_BASE_PATH must start and end with '/'.");
  }

  return {
    base,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
  };
});
