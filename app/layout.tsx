import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_Devanagari, Noto_Sans_Gujarati } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Transcripts are mostly Devanagari/Gujarati; ship fonts so they render the same on every OS.
const devanagari = Noto_Sans_Devanagari({ variable: "--font-deva", subsets: ["devanagari"] });
const gujarati = Noto_Sans_Gujarati({ variable: "--font-guj", subsets: ["gujarati"] });

export const metadata: Metadata = {
  title: "STT Playground",
  description: "Compare speech-to-text models on English and Indian languages.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${devanagari.variable} ${gujarati.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
