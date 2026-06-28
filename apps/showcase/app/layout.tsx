import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "SuperJam Showcase",
  description: "Hand-crafted SuperJam mini-apps — AI, data & onchain.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
