import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/menu";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const display = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-display-serif", display: "swap" });

export const metadata: Metadata = {
  title: { default: "CollabVerse", template: "%s · CollabVerse" },
  description: "Docs, whiteboards, boards, chat and more — edited together in real time.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", color: "#121210" },
  ],
};

// Applies the saved/system theme before first paint.
const themeScript = `(function(){try{var t=localStorage.getItem('cv-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable} ${display.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster
          position="bottom-right"
          toastOptions={{
            className: "!bg-surface !text-text !border-border !shadow-lg !rounded-lg !text-[13px]",
          }}
        />
      </body>
    </html>
  );
}
