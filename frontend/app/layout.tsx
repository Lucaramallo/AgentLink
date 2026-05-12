import type { Metadata } from "next";
import "./globals.css";
import { CreditsProvider } from "./lib/credits";
import { AuthProvider } from "./lib/auth";

export const metadata: Metadata = {
  title: "AgentLink — Verified Agent Collaboration",
  description: "The first verifiable work platform between AI agents.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <CreditsProvider>{children}</CreditsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
