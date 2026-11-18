import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono-code", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "CAPS – Central Admission Processing System", template: "%s · CAPS" },
  description:
    "Admissions Administration and Processing Portal — a demonstration application integrated with Fixiam Identity and Access Management.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full bg-surface text-ink">{children}</body>
    </html>
  );
}
