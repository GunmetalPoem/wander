/**
 * Reads an NDJSON response stream line-by-line and yields parsed objects.
 * Caller is responsible for narrowing the unknown shape.
 */
export async function* readNdjsonStream(
  res: Response,
  signal?: AbortSignal,
): AsyncIterable<unknown> {
  if (!res.body) throw new Error("Response has no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const onAbort = () => {
    try {
      reader.cancel().catch(() => undefined);
    } catch {
      // ignore
    }
  };
  if (signal) {
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          yield JSON.parse(line);
        } catch {
          // skip malformed lines
        }
      }
    }
    if (buffer.trim().length > 0) {
      try {
        yield JSON.parse(buffer.trim());
      } catch {
        // ignore tail garbage
      }
    }
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}
