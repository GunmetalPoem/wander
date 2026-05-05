/**
 * Run async work over items with a fixed pool size. Output order matches input order.
 */
export async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length;
  if (n === 0) return [];
  const pool = Math.max(1, Math.min(limit, n));
  const out = new Array<R>(n);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= n) return;
      out[i] = await mapper(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: pool }, () => worker()));
  return out;
}
