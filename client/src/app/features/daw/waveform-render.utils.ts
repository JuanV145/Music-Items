export interface WaveformBar {
  x: number;
  peak: number;
}

/** Builds at most one bar per available envelope sample, regardless of clip pixel width. */
export function buildWaveformBars(
  points: readonly number[],
  startPoint: number,
  endPoint: number,
  canvasWidth: number
): WaveformBar[] {
  const start = Math.max(0, Math.min(points.length, Math.floor(startPoint)));
  const end = Math.max(start, Math.min(points.length, Math.ceil(endPoint)));
  const width = Math.max(0, Math.floor(canvasWidth));
  const sampleCount = end - start;
  const columnCount = Math.min(sampleCount, width);
  if (columnCount === 0) return [];

  const bars: WaveformBar[] = [];
  for (let column = 0; column < columnCount; column++) {
    const from = start + Math.floor((column * sampleCount) / columnCount);
    const to = Math.max(from + 1, start + Math.floor(((column + 1) * sampleCount) / columnCount));
    let peak = 0;
    for (let index = from; index < Math.min(to, end); index++) {
      peak = Math.max(peak, points[index] || 0);
    }
    bars.push({ x: ((column + 0.5) * width) / columnCount, peak });
  }
  return bars;
}
