import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wander — trip planner",
  description:
    "Wander: AI itineraries with Mapbox, routing, and city confirmation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col font-sans font-normal">
        <header className="shrink-0 border-b border-white/[0.06] bg-coal/95 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3">
            <Link href="/" className="font-serif text-xl tracking-tight text-parchment hover:text-white">
              Wanderday
            </Link>
            <nav className="flex items-center gap-4 text-sm font-medium tracking-wide text-mist">
              <Link href="/" className="transition hover:text-parchment">
                Planner
              </Link>
            </nav>
          </div>
        </header>
        <main className="w-full min-h-0 flex-1 overflow-x-hidden bg-void px-4 py-4">{children}</main>
        <footer className="border-t border-white/[0.06] bg-coal/80 py-6 text-xs text-mist">
          <div className="mx-auto max-w-[1600px] px-4">
            Mapbox © Mapbox, OpenStreetMap. Routing is indicative; check traffic and closures. AI steps may be wrong—verify
            every stop.
          </div>
        </footer>
      </body>
    </html>
  );
}
