import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  BUILD_LOCK_MS,
  isBuildLocked,
  isRoomExpired,
  parseUnifiedDraft,
  readCookieId,
} from "@/lib/room-shared";
import { isPlanTripError, planTrip } from "@/lib/trip-plan-service";

export const maxDuration = 120;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const cookieId = await readCookieId();
  if (!cookieId) return NextResponse.json({ error: "Join the room first" }, { status: 401 });

  const room = await prisma.tripRoom.findUnique({ where: { id } });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (isRoomExpired(room.expiresAt)) {
    return NextResponse.json({ error: "Room expired" }, { status: 410 });
  }

  const participant = await prisma.roomParticipant.findUnique({
    where: { roomId_cookieId: { roomId: id, cookieId } },
  });
  if (!participant) return NextResponse.json({ error: "Not a member of this room" }, { status: 403 });

  if (isBuildLocked(room.planBuildLockAt ?? null)) {
    const holder = room.planBuildLockBy
      ? await prisma.roomParticipant.findUnique({ where: { id: room.planBuildLockBy } }).catch(() => null)
      : null;
    return NextResponse.json(
      {
        error: "build_in_progress",
        by: holder?.displayName ?? "Someone",
      },
      { status: 409 },
    );
  }

  // Atomic-ish check-and-set: re-read in a transaction to claim the lock.
  const claim = await prisma.$transaction(async (tx) => {
    const current = await tx.tripRoom.findUnique({ where: { id }, select: { planBuildLockAt: true, planBuildLockBy: true } });
    if (!current) return null;
    if (current.planBuildLockAt && Date.now() - current.planBuildLockAt.getTime() < BUILD_LOCK_MS) {
      return { locked: true, by: current.planBuildLockBy } as const;
    }
    await tx.tripRoom.update({
      where: { id },
      data: { planBuildLockAt: new Date(), planBuildLockBy: participant.id },
    });
    return { locked: false } as const;
  });

  if (!claim) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (claim.locked) {
    const holder = claim.by
      ? await prisma.roomParticipant.findUnique({ where: { id: claim.by } }).catch(() => null)
      : null;
    return NextResponse.json({ error: "build_in_progress", by: holder?.displayName ?? "Someone" }, { status: 409 });
  }

  const draft = parseUnifiedDraft(room.unifiedDraftJson);
  if (!draft.city.trim()) {
    await prisma.tripRoom.update({
      where: { id },
      data: { planBuildLockAt: null, planBuildLockBy: null },
    });
    return NextResponse.json(
      { error: "Tell me a city in chat first — the unified panel will fill in." },
      { status: 400 },
    );
  }
  // The plan service will auto-resolve the city via Mapbox/Google when cityCenter is null.
  const tripInput = { ...draft, cityLocationReady: true };

  try {
    const { plan, weather, warnings } = await planTrip(tripInput);
    await prisma.tripRoom.update({
      where: { id },
      data: {
        planJson: JSON.stringify(plan),
        planWeatherJson: weather ? JSON.stringify(weather) : null,
        planBuiltAt: new Date(),
        planBuildLockAt: null,
        planBuildLockBy: null,
      },
    });
    return NextResponse.json({ plan, weather, warnings });
  } catch (e) {
    await prisma.tripRoom
      .update({
        where: { id },
        data: { planBuildLockAt: null, planBuildLockBy: null },
      })
      .catch(() => undefined);
    if (isPlanTripError(e)) {
      return NextResponse.json({ error: e.error }, { status: e.status });
    }
    return NextResponse.json({ error: "Plan failed" }, { status: 500 });
  }
}
