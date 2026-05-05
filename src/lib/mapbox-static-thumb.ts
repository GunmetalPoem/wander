/**
 * Mapbox Static Images API — small map preview centered on a stop (no extra HTTP lib).
 * @see https://docs.mapbox.com/api/maps/static-images/
 */
export function mapboxStopThumbnailUrl(
  accessToken: string,
  lng: number,
  lat: number,
  options?: { zoom?: number; size?: number; stylePath?: string },
): string | null {
  const t = accessToken.trim();
  if (!t || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const zoom = options?.zoom ?? 15;
  const size = Math.min(256, Math.max(64, options?.size ?? 128));
  const stylePath = options?.stylePath ?? "mapbox/dark-v11";
  const pinColor = "94a3b8";
  const overlay = `pin-s+${pinColor}(${lng},${lat})`;
  const position = `${lng},${lat},${zoom},0,0`;
  const path = `https://api.mapbox.com/styles/v1/${stylePath}/static/${overlay}/${position}/${size}x${size}@2x`;
  return `${path}?access_token=${encodeURIComponent(t)}`;
}
