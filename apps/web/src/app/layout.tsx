import type { Metadata } from "next";
import { DM_Sans, Fraunces, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { ConvergeMark } from "@/components/ConvergeMark";
import { LedgerBadge } from "@/components/LedgerBadge";
import { Nav } from "@/components/Nav";
import "./globals.css";

const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dmsans", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "ALIGN Pay · Kettle & Kesar (fictional)",
  description: "Every refund and invoice your AI agent makes in PayPal traces back to a human decision.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${dmSans.variable} ${jetbrains.variable}`}>
      <body>
        <div className="sandbox-strip" data-testid="sandbox-strip">
          Fictional store · PayPal sandbox · no real money
        </div>
        <header className="top">
          <Link href="/" className="brand" aria-label="ALIGN Pay home">
            <ConvergeMark />
            <span className="word">
              ALIGN<span>Pay</span>
            </span>
          </Link>
          <Nav />
          <LedgerBadge />
        </header>
        <main>{children}</main>
        <footer>
          ALIGN Pay is open source (MIT). Kettle &amp; Kesar, its customers and its orders are fictional; payments run in the
          PayPal sandbox. The model proposes, a person confirms, plain code enforces.
        </footer>
      </body>
    </html>
  );
}
