import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lychgate: a graveyard for dead links",
  description: "Find every dead link, see how it died, and resurrect it from the Wayback Machine. Built for Kiroween 2026 by Demir.",
};

export const viewport: Viewport = { themeColor: "#0d0f14", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
