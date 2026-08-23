import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // Brand name only. Every other user-visible string goes through t() from
  // checkpoint 2 onward, including the per-route metadata that replaces this.
  title: "Business Listings",
  description: "UAE trade directory.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // dir is a variable, not a constant. Arabic flips it; no layout may assume ltr.
    <html lang="en" dir="ltr">
      <head>
        <link
          rel="preload"
          href="/fonts/geist-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/jetbrains-mono-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
