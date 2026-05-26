import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  COOKIE_MAX_AGE,
  COOKIE_NAME,
  MAX_PARTICIPANTS,
  colorFromCookieId,
  isRoomExpired,
  readOrAssignCookieId,
  sanitizeDisplayName,
} from "@/lib/room-shared";

const BodySchema = z.object({
  displayName: z.string().min(1).max(64),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const displayName = sanitizeDisplayName(parsed.data.displayName);
  if (!displayName) {
    return NextResponse.json({ error: "Display name required" }, { status: 400 });
  }

  const room = await prisma.tripRoom.findUnique({ where: { id } });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (isRoomExpired(room.expiresAt)) {
    return NextResponse.json({ error: "Room expired" }, { status: 410 });
  }

  const { cookieId, isNew } = await readOrAssignCookieId();

  const existing = await prisma.roomParticipant.findUnique({
    where: { roomId_cookieId: { roomId: id, cookieId } },
  });

  let participant;
  if (existing) {
    participant = await prisma.roomParticipant.update({
      where: { id: existing.id },
      data: { displayName, lastSeenAt: new Date() },
    });
  } else {
    const count = await prisma.roomParticipant.count({ where: { roomId: id } });
    if (count >= MAX_PARTICIPANTS) {
      return NextResponse.json({ error: "Room is full" }, { status: 403 });
    }
    const colorHex = colorFromCookieId(cookieId);
    participant = await prisma.roomParticipant.create({
      data: {
        roomId: id,
        cookieId,
        displayName,
        colorHex,
      },
    });
    await prisma.participantPreferences.create({
      data: {
        roomId: id,
        participantId: participant.id,
        prefsJson: JSON.stringify({ values: {}, touched: [] }),
      },
    });
  }

  const res = NextResponse.json({
    participantId: participant.id,
    displayName: participant.displayName,
    colorHex: participant.colorHex,
  });
  if (isNew) {
    res.cookies.set(COOKIE_NAME, cookieId, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE,
      path: "/",
    });
  }
  return res;
}
