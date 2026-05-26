import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { defaultTripForm, type TripFormInput } from "@/lib/trip-schema";
import { computeUnifiedDraft, type ParticipantPrefsEntry, type ConflictReport } from "@/lib/room-unified-draft";
import type { TripChatPatch } from "@/lib/trip-chat-merge";
import type { TripPlan } from "@/lib/trip-schema";
import type { TripWeather } from "@/lib/weather";

export const COOKIE_NAME = "wander_pid";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 90;
export const ROOM_TTL_DAYS = 14;
export const MAX_PARTICIPANTS = 10;
export const MAX_MESSAGE_LEN = 8000;
export const BUILD_LOCK_MS = 120_000;

export type RoomStateSnapshot = {
  room: { id: string; createdAt: number; expiresAt: number };
  participants: {
    id: string;
    displayName: string;
    colorHex: string;
    lastSeenAt: number;
  }[];
  messages: {
    id: string;
    participantId: string | null;
    role: "user" | "assistant";
    content: string;
    createdAt: number;
  }[];
  prefsByParticipant: Record<string, { values: TripChatPatch; touched: string[] }>;
  unifiedDraft: TripFormInput;
  conflicts: ConflictReport[];
  plan: TripPlan | null;
  planWeather: TripWeather | null;
  planBuiltAt: number | null;
  buildInProgress: boolean;
  buildLockBy: string | null;
  pendingAiCount: number;
  serverTime: number;
};

export function newCookieId(): string {
  const a = Math.random().toString(36).slice(2, 14);
  const b = Math.random().toString(36).slice(2, 14);
  return (a + b).slice(0, 24);
}

export function colorFromCookieId(cookieId: string): string {
  let h = 0;
  for (let i = 0; i < cookieId.length; i++) {
    h = (h * 31 + cookieId.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  const s = 0.55;
  const l = 0.6;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hh = hue / 60;
  let r = 0;
  let g = 0;
  let b = 0;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  if (hh < 1) {
    r = c;
    g = x;
  } else if (hh < 2) {
    r = x;
    g = c;
  } else if (hh < 3) {
    g = c;
    b = x;
  } else if (hh < 4) {
    g = x;
    b = c;
  } else if (hh < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = l - c / 2;
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function sanitizeDisplayName(raw: string): string {
  const chars: string[] = [];
  for (const ch of raw ?? "") {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) continue;
    chars.push(ch);
  }
  return chars.join("").replace(/\s+/g, " ").trim().slice(0, 32);
}

export async function readCookieId(): Promise<string | null> {
  const jar = await cookies();
  const v = jar.get(COOKIE_NAME)?.value;
  return v && v.length >= 8 ? v : null;
}

export async function readOrAssignCookieId(): Promise<{ cookieId: string; isNew: boolean }> {
  const existing = await readCookieId();
  if (existing) return { cookieId: existing, isNew: false };
  return { cookieId: newCookieId(), isNew: true };
}

export function isRoomExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() < Date.now();
}

export function isBuildLocked(lockAt: Date | null): boolean {
  if (!lockAt) return false;
  return Date.now() - lockAt.getTime() < BUILD_LOCK_MS;
}

export function parseUnifiedDraft(json: string | null): TripFormInput {
  if (!json) return { ...defaultTripForm };
  try {
    const parsed = JSON.parse(json) as Partial<TripFormInput>;
    return { ...defaultTripForm, ...parsed };
  } catch {
    return { ...defaultTripForm };
  }
}

export function parsePlan(json: string | null): TripPlan | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as TripPlan;
  } catch {
    return null;
  }
}

export function parseWeather(json: string | null): TripWeather | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as TripWeather;
  } catch {
    return null;
  }
}

export function parsePrefs(json: string): { values: TripChatPatch; touched: string[] } {
  try {
    const o = JSON.parse(json) as { values?: TripChatPatch; touched?: string[] };
    return { values: o.values ?? {}, touched: Array.isArray(o.touched) ? o.touched : [] };
  } catch {
    return { values: {}, touched: [] };
  }
}

export async function buildRoomSnapshot(roomId: string, sinceMs: number): Promise<RoomStateSnapshot | null> {
  const room = await prisma.tripRoom.findUnique({
    where: { id: roomId },
    include: {
      participants: { orderBy: { joinedAt: "asc" } },
      preferences: true,
    },
  });
  if (!room) return null;

  const sinceDate = new Date(Number.isFinite(sinceMs) ? sinceMs : 0);
  const messages = await prisma.roomMessage.findMany({
    where: { roomId, createdAt: { gt: sinceDate }, role: "user" },
    orderBy: { createdAt: "asc" },
  });
  const pendingAiCount = await prisma.roomMessage.count({
    where: { roomId, role: "user", aiProcessedAt: null },
  });

  const prefsByParticipant: Record<string, { values: TripChatPatch; touched: string[] }> = {};
  const prefsForMerge: Record<string, ParticipantPrefsEntry> = {};
  for (const p of room.preferences) {
    const parsed = parsePrefs(p.prefsJson);
    prefsByParticipant[p.participantId] = parsed;
    prefsForMerge[p.participantId] = {
      values: parsed.values,
      touched: parsed.touched,
      updatedAt: p.updatedAt.getTime(),
    };
  }

  const prior = parseUnifiedDraft(room.unifiedDraftJson);
  const { draft, conflicts } = computeUnifiedDraft(prefsForMerge, prior);
  if (prior.city.trim().toLowerCase() === draft.city.trim().toLowerCase()) {
    draft.cityCenter = prior.cityCenter;
    draft.cityLocationReady = prior.cityLocationReady;
  }

  return {
    room: {
      id: room.id,
      createdAt: room.createdAt.getTime(),
      expiresAt: room.expiresAt.getTime(),
    },
    participants: room.participants.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      colorHex: p.colorHex,
      lastSeenAt: p.lastSeenAt.getTime(),
    })),
    messages: messages.map((m) => ({
      id: m.id,
      participantId: m.participantId,
      role: m.role as "user" | "assistant",
      content: m.content,
      createdAt: m.createdAt.getTime(),
    })),
    prefsByParticipant,
    unifiedDraft: draft,
    conflicts,
    plan: parsePlan(room.planJson),
    planWeather: parseWeather(room.planWeatherJson),
    planBuiltAt: room.planBuiltAt?.getTime() ?? null,
    buildInProgress: isBuildLocked(room.planBuildLockAt ?? null),
    buildLockBy: room.planBuildLockBy ?? null,
    pendingAiCount,
    serverTime: Date.now(),
  };
}

const rateBuckets = new Map<string, number[]>();
export function rateLimitMessage(roomId: string, cookieId: string): boolean {
  const key = `${roomId}:${cookieId}`;
  const now = Date.now();
  const windowMs = 60_000;
  const max = 10;
  const arr = (rateBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    rateBuckets.set(key, arr);
    return false;
  }
  arr.push(now);
  rateBuckets.set(key, arr);
  return true;
}
