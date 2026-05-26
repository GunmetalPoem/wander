import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  MAX_MESSAGE_LEN,
  buildRoomSnapshot,
  isRoomExpired,
  rateLimitMessage,
  readCookieId,
} from "@/lib/room-shared";
import { kickProcessing } from "@/lib/room-process";

export const maxDuration = 30;

const BodySchema = z.object({
  content: z.string().min(1).max(MAX_MESSAGE_LEN),
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
  const content = parsed.data.content.trim();
  if (!content) return NextResponse.json({ error: "Empty message" }, { status: 400 });

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

  if (!rateLimitMessage(id, cookieId)) {
    return NextResponse.json({ error: "Too many messages; slow down a moment" }, { status: 429 });
  }

  // Persist user message immediately — AI extraction happens in the background.
  await prisma.roomMessage.create({
    data: {
      roomId: id,
      participantId: participant.id,
      role: "user",
      content,
    },
  });

  await prisma.roomParticipant.update({
    where: { id: participant.id },
    data: { lastSeenAt: new Date() },
  });

  // Fire-and-forget: AI catches up to the backlog asynchronously.
  kickProcessing(id);

  // Return a fresh snapshot (includes the new message, pendingAiCount reflects the backlog).
  const snap = await buildRoomSnapshot(id, 0);
  return NextResponse.json(snap);
}
