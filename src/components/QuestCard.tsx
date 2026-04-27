import Link from "next/link";

export type QuestCardQuest = {
  slug: string;
  title: string;
  loreBlurb: string;
  difficulty: number;
  safetyScore: number;
  category: string;
  warnings: string[];
};

const categoryLabel: Record<string, string> = {
  tradition: "Tradition",
  urban_exploration: "Urban exploration",
  social: "Social",
  history: "History",
  challenge: "Challenge",
};

export function QuestCard({ quest }: { quest: QuestCardQuest }) {
  return (
    <Link
      href={`/quests/${quest.slug}`}
      className="group block rounded-2xl border border-white/10 bg-white/5 p-5 shadow-lg shadow-black/30 transition hover:border-ember/40 hover:bg-white/[0.07]"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="font-serif text-lg text-parchment group-hover:text-white">{quest.title}</h2>
        <span className="rounded-full bg-moss/40 px-2 py-0.5 text-[11px] uppercase tracking-wide text-emerald-100">
          {categoryLabel[quest.category] ?? quest.category}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-parchment/75">{quest.loreBlurb}</p>
      <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-parchment/60">
        <span>Difficulty {quest.difficulty}/5</span>
        <span>·</span>
        <span>Safety risk {quest.safetyScore}/5</span>
        {quest.warnings.length > 0 && (
          <>
            <span>·</span>
            <span className="text-amber-200/80">{quest.warnings.join(", ")}</span>
          </>
        )}
      </div>
    </Link>
  );
}
