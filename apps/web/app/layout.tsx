import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ProjectOS Health", template: "%s · ProjectOS Health" },
  description: "Healthcare operations: projects, credentialing, scheduling and revenue-cycle work in one system.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request headers makes every page dynamic, which the per-request CSP nonce (proxy.ts) requires.
  await headers();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
