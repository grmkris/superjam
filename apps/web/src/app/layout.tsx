import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ClientRoot } from "../components/client-root";
import "./globals.css";

const TITLE = "SuperJam — make a jam, share the jam";
const DESCRIPTION = "Make and play little apps. With money. On the open web.";

// icon / apple-icon / opengraph-image / twitter-image are auto-wired from the
// matching files in this directory; metadataBase makes their URLs absolute.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://superjam.fun"),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "SuperJam",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  // zoom stays enabled — desktop + accessibility need pinch/zoom (was maximumScale: 1)
  userScalable: true,
  themeColor: "#FAFAF8",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Bricolage Grotesque — the distinctive modern display face that carries
            the whole product voice. Hanken Grotesk — the calm reading companion
            for long-form prose (.prose-body). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ClientRoot>{children}</ClientRoot>
      </body>
    </html>
  );
}
