import { QuestCard } from "@/components/QuestCard";
import { parseStringArray } from "@/lib/quest-json";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

const categories = [
  { id: "tradition", label: "Tradition" },
  { id: "urban_exploration", label: "Urban exploration" },
  { id: "social", label: "Social" },
  { id: "history", label: "History" },
  { id: "challenge", label: "Challenge" },
] as const;

type Search = { category?: string; maxRisk?: string };

export default async function LoreFeedPage({ searchParams }: { searchParams: Search }) {
  const category = categories.some((c) => c.id === searchParams.category)
    ? searchParams.category
    : undefined;
  const maxRisk = searchParams.maxRisk ? Number(searchParams.maxRisk) : undefined;
  const maxRiskSafe =
    typeof maxRisk === "number" && maxRisk >= 1 && maxRisk <= 5 ? maxRisk : undefined;

  const quests = await prisma.quest.findMany({
    where: {
      status: "published",
      ...(category ? { category } : {}),
      ...(maxRiskSafe ? { safetyScore: { lte: maxRiskSafe } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  function href(next: Partial<{ category: string | null; maxRisk: string | null }>) {
    const params = new URLSearchParams();
    const cat = next.category !== undefined ? next.category : category ?? null;
    const risk = next.maxRisk !== undefined ? next.maxRisk : maxRiskSafe?.toString() ?? null;
    if (cat) params.set("category", cat);
    if (risk) params.set("maxRisk", risk);
    const s = params.toString();
    return s ? `/lore?${s}` : "/lore";
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <section className="space-y-3">
        <p className="text-xs uppercase tracking-[0.2em] text-ember/90">Side quests from real places</p>
        <h1 className="font-serif text-3xl text-parchment sm:text-4xl">
          Hidden traditions, routes, and campus lore — structured, not sanitized into oblivion.
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-parchment/70">
          This build has no accounts: browse published quests, then open{" "}
          <Link href="/admin" className="text-ember underline-offset-4 hover:underline">
            Lab
          </Link>{" "}
          to scrape a URL and let the model draft categorized entries. Always verify access and rules in the real world.
        </p>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/20 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="text-xs text-parchment/50">Category</p>
          <div className="flex flex-wrap gap-2">
            <FilterPill href={href({ category: null })} active={!category}>
              All
            </FilterPill>
            {categories.map((c) => (
              <FilterPill key={c.id} href={href({ category: c.id })} active={category === c.id}>
                {c.label}
              </FilterPill>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-parchment/50">Max safety risk (1 calm → 5 heavy)</p>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <FilterPill
                key={n}
                href={href({ maxRisk: String(n) })}
                active={maxRiskSafe === n}
              >
                ≤ {n}
              </FilterPill>
            ))}
            <FilterPill href={href({ maxRisk: null })} active={!maxRiskSafe}>
              Any
            </FilterPill>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {quests.map((q) => (
          <QuestCard
            key={q.id}
            quest={{
              slug: q.slug,
              title: q.title,
              loreBlurb: q.loreBlurb,
              difficulty: q.difficulty,
              safetyScore: q.safetyScore,
              category: q.category,
              warnings: parseStringArray(q.warnings),
            }}
          />
        ))}
      </section>

      {quests.length === 0 && (
        <p className="rounded-xl border border-dashed border-white/15 bg-white/5 p-6 text-sm text-parchment/70">
          No quests match these filters. Clear filters or seed the database (
          <code className="text-parchment">npm run db:seed</code>).
        </p>
      )}
    </div>
  );
}

function FilterPill({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-xs transition ${
        active
          ? "bg-ember/90 text-white"
          : "bg-white/5 text-parchment/80 hover:bg-white/10 hover:text-parchment"
      }`}
    >
      {children}
    </Link>
  );
}
