import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/arc-lab/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ARC Lab — Interactive Abstract Reasoning Laboratory",
  description:
    "Learn abstract reasoning puzzle by puzzle in the Academy, debug transformation programs in the Workbench, and benchmark solvers reproducibly in the Arena. Built for the ARC-AGI era.",
  keywords: ["ARC", "ARC-AGI", "abstract reasoning", "puzzle game", "benchmark", "program synthesis", "grid puzzles"],
  authors: [{ name: "ARC Lab" }],
  openGraph: {
    title: "ARC Lab — Interactive Abstract Reasoning Laboratory",
    description: "Solve · Debug · Benchmark — one integrated lab for ARC reasoning.",
    siteName: "ARC Lab",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
