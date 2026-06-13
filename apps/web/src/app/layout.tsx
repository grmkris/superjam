import type { ReactNode } from "react";
import { ClientRoot } from "../components/client-root";
import "./globals.css";

export const metadata = {
  title: "SuperJam — make a jam, share the jam",
  description: "Make and play little apps. With money. On the open web.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#E9E9EE",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Baloo 2 — the Toybox display face (DESIGN_BRIEF §2). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ClientRoot>{children}</ClientRoot>
      </body>
    </html>
  );
}
