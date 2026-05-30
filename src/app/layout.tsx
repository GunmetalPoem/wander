import type { Metadata } from "next";
import Link from "next/link";
import { WanderIcon } from "@/components/WanderIcon";
import { ToastProvider } from "@/components/ui/Toast";
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
        <ToastProvider>
          <header className="shrink-0 border-b border-white/[0.06] bg-coal/70 backdrop-blur-xl">
            <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-2.5">
              <Link
                href="/"
                className="group flex items-center gap-2.5 font-serif text-lg tracking-tight text-parchment transition-colors duration-200 hover:text-white"
              >
                <span className="transition-transform duration-300 ease-out-expo group-hover:rotate-[8deg]">
                  <WanderIcon size={24} strokeWidth={2.25} />
                </span>
                <span>Wander</span>
              </Link>
            </div>
          </header>
          <main className="relative w-full min-h-0 flex-1 overflow-x-hidden bg-void">
            {children}
          </main>
          <footer className="border-t border-white/[0.04] bg-coal/60 py-3 text-[10px] text-mist/70">
            <div className="mx-auto max-w-[1600px] px-4 text-center">
              Mapbox © Mapbox, OpenStreetMap. AI steps may be wrong — verify every stop.
            </div>
          </footer>
        </ToastProvider>
      </body>
    </html>
  );
}
