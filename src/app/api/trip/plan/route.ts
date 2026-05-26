import { NextResponse } from "next/server";
import { z } from "zod";
import { isPlanTripError, planTrip, tripFormFromPartial } from "@/lib/trip-plan-service";

export const maxDuration = 120;

const RequestBodySchema = z.object({
  city: z.string().min(1).max(200),
  days: z.number().int().min(1).max(14).optional(),
  groupSize: z.number().int().min(1).max(50).optional(),
  budgetAmount: z.number().min(0).max(100000).optional(),
  pace: z.enum(["packed", "balanced", "relaxed"]).optional(),
  vibes: z.array(z.string()).optional(),
  mustInclude: z.string().max(2000).optional(),
  mustExclude: z.string().max(2000).optional(),
  transport: z.enum(["walking", "driving"]).optional(),
  cityCenter: z.object({ lat: z.number(), lng: z.number() }).nullish(),
  tripDate: z.string().nullish(),
  accessibility: z
    .object({
      wheelchair: z.boolean().optional(),
      lowWalking: z.boolean().optional(),
      restStops: z.boolean().optional(),
    })
    .optional(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = RequestBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const input = tripFormFromPartial(parsed.data);

  try {
    const { plan, weather, provider, warnings } = await planTrip(input);
    return NextResponse.json({ plan, provider, weather, warnings });
  } catch (e) {
    if (isPlanTripError(e)) {
      const body = e.details ? { error: e.error, ...(e.details as object) } : { error: e.error };
      return NextResponse.json(body, { status: e.status });
    }
    return NextResponse.json({ error: "Plan failed" }, { status: 500 });
  }
}
