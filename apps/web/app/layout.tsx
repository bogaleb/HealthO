import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ProjectOS Health", template: "%s · ProjectOS Health" },
  description: "Healthcare operations: projects, credentialing, scheduling and revenue-cycle work in one system.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
