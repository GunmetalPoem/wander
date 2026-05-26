import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { defaultTripForm } from "@/lib/trip-schema";
import { ROOM_TTL_DAYS } from "@/lib/room-shared";

export async function POST() {
  const expiresAt = new Date(Date.now() + ROOM_TTL_DAYS * 24 * 60 * 60 * 1000);
  const room = await prisma.tripRoom.create({
    data: {
      expiresAt,
      unifiedDraftJson: JSON.stringify(defaultTripForm),
    },
    select: { id: true },
  });
  return NextResponse.json({ id: room.id, joinUrl: `/trip/room/${room.id}` });
}
