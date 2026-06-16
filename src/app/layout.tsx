import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "friday — agent kanban",
  description:
    "Local kanban board orchestrating Claude Code + Codex CLI agents across local projects.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased font-sans bg-bg text-ink">{children}</body>
    </html>
  );
}
