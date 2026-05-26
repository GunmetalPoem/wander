import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { GroupTripRoomClient } from "@/components/trip/room/GroupTripRoomClient";
import { COOKIE_NAME, buildRoomSnapshot, isRoomExpired } from "@/lib/room-shared";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function TripRoomPage({ params }: PageProps) {
  const { id } = await params;
  const room = await prisma.tripRoom.findUnique({ where: { id }, select: { id: true, expiresAt: true } });
  if (!room) notFound();
  if (isRoomExpired(room.expiresAt)) {
    return (
      <div className="grid min-h-screen place-items-center bg-coal text-parchment">
        <div className="max-w-sm rounded-2xl border border-white/10 bg-black/40 p-6 text-center">
          <h1 className="font-serif text-2xl">Room expired</h1>
          <p className="mt-2 text-sm text-parchment/70">
            This trip room is older than 14 days. Start a fresh one from{" "}
            <Link href="/" className="text-wander hover:underline">
              the planner
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  const snap = await buildRoomSnapshot(id, 0);
  if (!snap) notFound();

  const jar = await cookies();
  const cookieId = jar.get(COOKIE_NAME)?.value ?? null;
  let meId: string | null = null;
  if (cookieId) {
    const me = await prisma.roomParticipant.findUnique({
      where: { roomId_cookieId: { roomId: id, cookieId } },
    });
    meId = me?.id ?? null;
  }

  return <GroupTripRoomClient roomId={id} initialSnapshot={snap} initialMeId={meId} />;
}
