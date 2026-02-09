import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "highlight.js/styles/github-dark.css";
import "katex/dist/katex.min.css";
import { ToastProvider } from "@/components/ui/toast";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "dev.chat",
  description: "Local-first AI chat interface powered by Chutes API",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} font-sans antialiased`}
      >
        <ToastProvider>
          {children}
          <Analytics />
          <SpeedInsights />
        </ToastProvider>
      </body>
    </html>
  );
}

