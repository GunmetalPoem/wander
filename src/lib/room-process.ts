import { prisma } from "@/lib/prisma";
import { extractParticipantPatch } from "@/lib/trip-extract-prefs";
import { appendMustExclude, type TripChatPatch } from "@/lib/trip-chat-merge";
import { computeUnifiedDraft, type ParticipantPrefsEntry } from "@/lib/room-unified-draft";
import { parsePrefs, parseUnifiedDraft } from "@/lib/room-shared";

const PROCESSING_TIMEOUT_MS = 60_000;

const inFlightByRoom = new Map<string, Promise<void>>();

export function kickProcessing(roomId: string): void {
  if (inFlightByRoom.has(roomId)) return;
  const p = processPendingMessages(roomId).finally(() => {
    inFlightByRoom.delete(roomId);
  });
  inFlightByRoom.set(roomId, p);
}

async function claimNextMessage(roomId: string) {
  const staleCutoff = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
  // Atomic-ish: find oldest unprocessed (or stale-processing), then try to claim by stamping aiProcessingAt.
  const candidate = await prisma.roomMessage.findFirst({
    where: {
      roomId,
      role: "user",
      aiProcessedAt: null,
      OR: [{ aiProcessingAt: null }, { aiProcessingAt: { lt: staleCutoff } }],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, aiProcessingAt: true },
  });
  if (!candidate) return null;

  const claim = await prisma.roomMessage.updateMany({
    where: {
      id: candidate.id,
      aiProcessedAt: null,
      OR: [{ aiProcessingAt: null }, { aiProcessingAt: { lt: staleCutoff } }],
    },
    data: { aiProcessingAt: new Date() },
  });
  if (claim.count === 0) return null;

  return prisma.roomMessage.findUnique({
    where: { id: candidate.id },
    include: { room: false },
  });
}

function mergePatchIntoValues(prior: TripChatPatch, patch: TripChatPatch): TripChatPatch {
  const next: TripChatPatch = { ...prior };
  if (typeof patch.city === "string" && patch.city.trim()) next.city = patch.city.trim();
  if (typeof patch.days === "number" && Number.isFinite(patch.days)) {
    next.days = Math.max(1, Math.min(14, Math.round(patch.days)));
  }
  if (typeof patch.groupSize === "number" && Number.isFinite(patch.groupSize)) {
    next.groupSize = Math.max(1, Math.min(50, Math.round(patch.groupSize)));
  }
  if (typeof patch.budgetAmount === "number" && Number.isFinite(patch.budgetAmount)) {
    next.budgetAmount = Math.max(0, Math.min(100000, patch.budgetAmount));
  }
  if (patch.pace === "packed" || patch.pace === "balanced" || patch.pace === "relaxed") {
    next.pace = patch.pace;
  }
  if (Array.isArray(patch.vibes)) next.vibes = patch.vibes;
  if (typeof patch.mustInclude === "string" && patch.mustInclude.trim()) {
    next.mustInclude = appendMustExclude(next.mustInclude ?? "", patch.mustInclude);
  }
  if (typeof patch.mustExclude === "string" && patch.mustExclude.trim()) {
    next.mustExclude = appendMustExclude(next.mustExclude ?? "", patch.mustExclude);
  }
  if (patch.transport === "walking" || patch.transport === "driving") {
    next.transport = patch.transport;
  }
  if (typeof patch.tripDate === "string") next.tripDate = patch.tripDate.slice(0, 32);
  if (patch.accessibility && typeof patch.accessibility === "object") {
    next.accessibility = {
      wheelchair: Boolean(patch.accessibility.wheelchair ?? next.accessibility?.wheelchair),
      lowWalking: Boolean(patch.accessibility.lowWalking ?? next.accessibility?.lowWalking),
      restStops: Boolean(patch.accessibility.restStops ?? next.accessibility?.restStops),
    };
  }
  return next;
}

async function processOne(messageId: string, participantId: string, content: string): Promise<void> {
  const participant = await prisma.roomParticipant.findUnique({ where: { id: participantId } });
  if (!participant) {
    await prisma.roomMessage.update({
      where: { id: messageId },
      data: { aiProcessedAt: new Date(), aiProcessingAt: null },
    });
    return;
  }

  // Build this participant's recent stream (last 20 of their own messages, plus the new one).
  const recent = await prisma.roomMessage.findMany({
    where: { roomId: participant.roomId, participantId, role: "user" },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const stream = recent
    .slice()
    .reverse()
    .map((m) => ({ role: "user" as const, content: m.content }));
  // Ensure the message under processing is at the end.
  if (!stream.length || stream[stream.length - 1]!.content !== content) {
    stream.push({ role: "user", content });
  }

  const prefsRow = await prisma.participantPreferences.findUnique({
    where: { participantId },
  });
  const priorPrefs = prefsRow ? parsePrefs(prefsRow.prefsJson) : { values: {}, touched: [] };

  let patch: TripChatPatch = {};
  let touched: string[] = priorPrefs.touched;
  try {
    const ext = await extractParticipantPatch({
      displayName: participant.displayName,
      recentMessages: stream,
      priorPrefs,
    });
    patch = ext.patch;
    touched = ext.touched;
  } catch {
    // Mark as processed anyway so we don't loop forever on a flaky message.
  }

  const nextValues = mergePatchIntoValues(priorPrefs.values, patch);

  await prisma.participantPreferences.upsert({
    where: { participantId },
    create: {
      roomId: participant.roomId,
      participantId,
      prefsJson: JSON.stringify({ values: nextValues, touched }),
    },
    update: {
      prefsJson: JSON.stringify({ values: nextValues, touched }),
    },
  });

  // Recompute unified draft.
  const allPrefs = await prisma.participantPreferences.findMany({ where: { roomId: participant.roomId } });
  const prefsForMerge: Record<string, ParticipantPrefsEntry> = {};
  for (const p of allPrefs) {
    const parsedPrefs = parsePrefs(p.prefsJson);
    prefsForMerge[p.participantId] = {
      values: parsedPrefs.values,
      touched: parsedPrefs.touched,
      updatedAt: p.updatedAt.getTime(),
    };
  }
  const room = await prisma.tripRoom.findUnique({ where: { id: participant.roomId } });
  if (room) {
    const prior = parseUnifiedDraft(room.unifiedDraftJson);
    const { draft } = computeUnifiedDraft(prefsForMerge, prior);
    if (prior.city.trim().toLowerCase() === draft.city.trim().toLowerCase()) {
      draft.cityCenter = prior.cityCenter;
      draft.cityLocationReady = prior.cityLocationReady;
    }
    await prisma.tripRoom.update({
      where: { id: participant.roomId },
      data: { unifiedDraftJson: JSON.stringify(draft) },
    });
  }

  await prisma.roomMessage.update({
    where: { id: messageId },
    data: { aiProcessedAt: new Date(), aiProcessingAt: null },
  });
}

export async function processPendingMessages(roomId: string): Promise<void> {
  // Process up to N per kick to avoid runaway loops.
  for (let i = 0; i < 50; i++) {
    const msg = await claimNextMessage(roomId);
    if (!msg) return;
    if (!msg.participantId) {
      await prisma.roomMessage.update({
        where: { id: msg.id },
        data: { aiProcessedAt: new Date(), aiProcessingAt: null },
      });
      continue;
    }
    try {
      await processOne(msg.id, msg.participantId, msg.content);
    } catch {
      // On unexpected failure, mark processed so we don't block.
      await prisma.roomMessage
        .update({
          where: { id: msg.id },
          data: { aiProcessedAt: new Date(), aiProcessingAt: null },
        })
        .catch(() => undefined);
    }
  }
}

export async function pendingAiCount(roomId: string): Promise<number> {
  return prisma.roomMessage.count({
    where: { roomId, role: "user", aiProcessedAt: null },
  });
}
