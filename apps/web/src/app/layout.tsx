import type { ReactNode } from "react";

export const metadata = {
  title: "SuperJam",
  description: "Make and play AI mini-apps.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
