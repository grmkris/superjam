import type { ReactNode } from "react";

export const metadata = {
  title: "Guestbook — a SuperJam mini-app",
  description: "An external, developer-hosted SuperJam mini-app (Next.js + Neon).",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          background: "#fdfbf3",
          color: "#1a1a1a",
        }}
      >
        {children}
      </body>
    </html>
  );
}
