import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Content-Security-Policy is set per request (with a nonce) in proxy.ts.
// Single source of configuration: the repo-root .env (works on Windows/macOS/Linux, no symlinks).
const rootEnv = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  reactStrictMode: true,
  // Production images (Dockerfile) build a self-contained server; local `pnpm start` keeps the normal output.
  output: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "standalone" : undefined,
  outputFileTracingRoot: resolve(process.cwd(), "../.."),
  poweredByHeader: false,
  transpilePackages: [
    "@projectos/ui",
    "@projectos/shared",
    "@projectos/core",
    "@projectos/auth",
    "@projectos/db",
    "@projectos/credentialing",
    "@projectos/scheduling",
    "@projectos/notifications",
    "@projectos/rcm",
    "@projectos/reports",
    "@projectos/integrations",
    "@projectos/compliance",
  ],
  serverExternalPackages: ["postgres"],
  typedRoutes: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // HSTS only matters behind HTTPS (the ALB in the Terraform plan); browsers ignore it on http://localhost.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default config;
