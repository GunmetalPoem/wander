import { NextResponse } from "next/server";
import { searchPlaces } from "@/lib/geocode";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ results: [] as { name: string; lat: number; lng: number }[] });
  }

  try {
    const results = await searchPlaces(q, 12);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "Geocoding failed" }, { status: 502 });
  }
}
