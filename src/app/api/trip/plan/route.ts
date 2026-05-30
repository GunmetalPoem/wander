import { z } from "zod";
import { planTripStream, tripFormFromPartial, type PlanStreamEvent } from "@/lib/trip-plan-service";

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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON" });
  }
  const parsed = RequestBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(400, { error: "Invalid request", details: parsed.error.flatten() });
  }

  const input = tripFormFromPartial(parsed.data);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const writeLine = (ev: PlanStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        } catch {
          // controller already closed by the client disconnecting
          closed = true;
        }
      };

      try {
        await planTripStream(input, writeLine);
      } catch (e) {
        writeLine({
          type: "error",
          status: 500,
          error: e instanceof Error ? e.message : "Plan failed",
        });
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      // Disable proxy buffering so each NDJSON line reaches the client immediately.
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
