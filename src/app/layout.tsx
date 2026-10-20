import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { ui } from "@/lib/copy/wording";
import "./globals.css";

export const metadata: Metadata = {
  title: ui.appName,
  description: ui.tagline,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand-link">
            {ui.appName}
          </Link>
        </header>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
