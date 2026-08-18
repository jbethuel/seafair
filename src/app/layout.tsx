import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/providers/app-providers";
import { UtilityBar } from "@/components/layout/utility-bar";
import { AppNav } from "@/components/layout/app-nav";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Seafair — Marine Work Orders",
  description: "Vessel-scoped work order management for a marine fleet.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <AppProviders>
          <UtilityBar />
          <AppNav />
          <main className="flex-1">{children}</main>
        </AppProviders>
      </body>
    </html>
  );
}
