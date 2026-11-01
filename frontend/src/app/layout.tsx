import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/app/ui/globals.css";
import Header from "@/components/Header"; // Import the new Header
import { AuthProvider } from "@/providers/AuthProvider";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "AIGENKI - Personal Knowledge Graph",
  description: "A flexible, AI-powered SRS",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the theme script sets data-theme before React hydrates.
    <html lang="en" className="overflow-y-scroll" suppressHydrationWarning>
      <head>
        {/* Apply the saved light/dark theme before first paint (no flash of the light theme). */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static, self-contained theme bootstrap from lib/theme.ts */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${inter.className} bg-shodo-paper text-shodo-ink`}>
        <AuthProvider>
          {/* The Header component provides navigation for all pages */}
          <Header />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
