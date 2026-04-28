import type { Metadata } from "next";
import { DM_Sans, Literata } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
});

const literata = Literata({
  subsets: ["latin"],
  variable: "--font-literata",
});

export const metadata: Metadata = {
  title: "Wander — trip planner & quests",
  description:
    "Wander: AI itineraries with Mapbox, routing, city confirmation, and a quest feed with Lab tools.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${literata.variable}`}>
      <body className="font-sans flex min-h-screen flex-col">
        <header className="shrink-0 border-b border-white/10 bg-black/20 backdrop-blur">
          <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="font-serif text-xl tracking-tight text-parchment hover:text-white">
              Wanderday
            </Link>
            <nav className="flex items-center gap-4 text-sm text-parchment/80">
              <Link href="/" className="hover:text-parchment">
                Planner
              </Link>
              <Link href="/lore" className="hover:text-parchment">
                Quest feed
              </Link>
              <Link href="/admin" className="hover:text-parchment">
                Lab
              </Link>
            </nav>
          </div>
        </header>
        <main className="w-full min-h-0 flex-1 overflow-x-hidden px-4 py-4">{children}</main>
        <footer className="mx-auto max-w-[1600px] px-4 py-6 text-xs text-parchment/50">
          Mapbox © Mapbox, OpenStreetMap. Routing is indicative; check traffic and closures. AI steps may be wrong—verify
          every stop. <Link href="/lore" className="text-ember/90 hover:underline">Quest feed</Link> (URL{" "}
          <code className="text-parchment/70">/lore</code>).
        </footer>
      </body>
    </html>
  );
}
