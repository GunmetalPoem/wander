import { NextResponse } from "next/server";
import { assertAdminSecret } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Wipes all drafts, published quests, and raw scrapes. Lab-only maintenance.
 * Order: Quest rows first (FK to RawScrape), then RawScrape.
 */
export async function POST(req: Request) {
  try {
    assertAdminSecret(req);
  } catch (e) {
    const err = e as Error & { statusCode?: number };
    if (err.statusCode === 401) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw e;
  }

  const { count: questsDeleted } = await prisma.quest.deleteMany();
  const { count: rawsDeleted } = await prisma.rawScrape.deleteMany();

  return NextResponse.json({ ok: true, questsDeleted, rawScrapesDeleted: rawsDeleted });
}
