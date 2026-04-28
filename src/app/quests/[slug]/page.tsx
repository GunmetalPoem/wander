import { parseStringArray } from "@/lib/quest-json";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

const categoryLabel: Record<string, string> = {
  tradition: "Tradition",
  urban_exploration: "Urban exploration",
  social: "Social",
  history: "History",
  challenge: "Challenge",
};

export default async function QuestPage({ params }: { params: { slug: string } }) {
  const quest = await prisma.quest.findFirst({
    where: { slug: params.slug },
  });

  if (!quest) notFound();
  const isDraft = quest.status === "draft";

  const warnings = parseStringArray(quest.warnings);
  const steps = parseStringArray(quest.steps);

  const hasCoords = quest.lat != null && quest.lng != null && !Number.isNaN(quest.lat) && !Number.isNaN(quest.lng);
  const d = 0.012;
  const bbox =
    hasCoords && quest.lng != null && quest.lat != null
      ? `${quest.lng - d},${quest.lat - d},${quest.lng + d},${quest.lat + d}`
      : null;

  return (
    <article className="mx-auto max-w-5xl space-y-8">
      {isDraft && (
        <div className="rounded-xl border border-amber-400/40 bg-amber-500/15 px-4 py-3 text-sm text-amber-50">
          Draft — this quest is not shown on the public feed until you publish it from Lab.
        </div>
      )}
      <div className="space-y-3">
        <Link href="/" className="text-xs text-parchment/50 hover:text-parchment">
          ← Back to feed
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="font-serif text-3xl text-parchment sm:text-4xl">{quest.title}</h1>
          <span className="rounded-full bg-moss/40 px-3 py-1 text-xs uppercase tracking-wide text-emerald-100">
            {categoryLabel[quest.category] ?? quest.category}
          </span>
        </div>
        <p className="text-lg text-parchment/85">{quest.loreBlurb}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:col-span-1">
          <p className="text-xs uppercase tracking-wide text-parchment/50">Difficulty</p>
          <p className="mt-1 font-serif text-2xl text-parchment">{quest.difficulty}/5</p>
        </div>
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 md:col-span-1">
          <p className="text-xs uppercase tracking-wide text-amber-100/70">Safety risk</p>
          <p className="mt-1 font-serif text-2xl text-amber-50">{quest.safetyScore}/5</p>
          <p className="mt-2 text-xs text-amber-100/70">
            Higher means more caution: unclear access, night, height, crowds, weather, or physical effort.
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:col-span-1">
          <p className="text-xs uppercase tracking-wide text-parchment/50">Location</p>
          <p className="mt-1 text-sm text-parchment">{quest.locationName ?? "Not pinned"}</p>
          {quest.sourceUrl && (
            <a
              href={quest.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs text-ember hover:underline"
            >
              Source link
            </a>
          )}
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-2xl border border-amber-400/25 bg-black/30 p-4">
          <p className="text-xs uppercase tracking-wide text-amber-100/80">Warnings</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-50/90">
            {warnings.map((w) => (
              <li key={w}>{w.replaceAll("_", " ")}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="font-serif text-xl text-parchment">Details</h2>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-parchment/80">{quest.description}</p>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-xl text-parchment">Steps</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-parchment/85">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </section>

      {hasCoords && bbox && quest.lat != null && quest.lng != null && (
        <section className="space-y-2">
          <h2 className="font-serif text-xl text-parchment">Map</h2>
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <iframe
              title="OpenStreetMap"
              className="h-72 w-full bg-black"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${quest.lat}%2C${quest.lng}`}
            />
          </div>
          <a
            className="text-xs text-ember hover:underline"
            href={`https://www.openstreetmap.org/?mlat=${quest.lat}&mlon=${quest.lng}#map=16/${quest.lat}/${quest.lng}`}
            target="_blank"
            rel="noreferrer"
          >
            Open full map
          </a>
        </section>
      )}
    </article>
  );
}
