import type { ReactNode } from "react";

export const metadata = { title: "TurboJam", description: "AI-built mini apps" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#0b0d12",
          color: "#e6e9ef",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        {children}
      </body>
    </html>
  );
}
