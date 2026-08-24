import type { Metadata } from "next";
import { siteUrl } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  // metadataBase is what turns every page's relative `alternates.canonical`
  // into an absolute URL. Without it Next emits a relative canonical, which
  // some crawlers resolve against the wrong origin.
  metadataBase: new URL(siteUrl()),
  title: {
    default: "Business Listings — UAE trade directory",
    template: "%s — Business Listings",
  },
  description: "Find licensed UAE suppliers and send one enquiry.",
  openGraph: {
    type: "website",
    siteName: "Business Listings",
    locale: "en_AE",
  },
  // The directory is the product; a Twitter card costs nothing and stops a
  // shared storefront rendering as a bare URL.
  twitter: { card: "summary_large_image" },
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
