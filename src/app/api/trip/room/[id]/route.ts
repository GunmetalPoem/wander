import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildRoomSnapshot, isRoomExpired, readCookieId } from "@/lib/room-shared";
import { kickProcessing, pendingAiCount } from "@/lib/room-process";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const sinceRaw = searchParams.get("since");
  const sinceMs = sinceRaw ? Number(sinceRaw) : 0;

  const snap = await buildRoomSnapshot(id, sinceMs);
  if (!snap) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (isRoomExpired(new Date(snap.room.expiresAt))) {
    return NextResponse.json({ error: "Room expired" }, { status: 410 });
  }

  const cookieId = await readCookieId();
  if (cookieId) {
    await prisma.roomParticipant
      .updateMany({
        where: { roomId: id, cookieId },
        data: { lastSeenAt: new Date() },
      })
      .catch(() => undefined);
  }

  // Opportunistically kick the background processor — picks up any orphaned/in-flight work.
  const pending = await pendingAiCount(id);
  if (pending > 0) kickProcessing(id);

  return NextResponse.json({ ...snap, pendingAiCount: pending });
}
