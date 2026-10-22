export interface TimeMark { time: number; label: string; }
export interface GridLine { time: number; }

export interface RulerView {
  pixelsPerSecond: number;
  scrollOffset: number;
  visibleDuration: number;
  projectDuration: number;
}

const MARK_INTERVALS = [0.125, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
const GRID_INTERVALS = [0.0625, 0.125, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

export function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const total = Math.floor(safe);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

function formatRulerTime(seconds: number, interval: number): string {
  if (interval >= 1) return formatTime(seconds);
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const whole = Math.floor(safe + 1e-8);
  const milliseconds = Math.round((safe - whole) * 1000);
  if (milliseconds <= 0) return formatTime(whole);
  return `${formatTime(whole)}.${String(milliseconds).padStart(3, '0').replace(/0+$/, '')}`;
}

function pickInterval(intervals: number[], pixelsPerSecond: number, desiredPixels: number, fallback: number): number {
  return intervals.find(interval => interval * pixelsPerSecond >= desiredPixels) ?? fallback;
}

/** Calcula marcas de la regla y líneas de cuadrícula, reutilizando el resultado si el rango no cambia. */
export class TimelineRuler {
  private marksCache: { key: string; value: TimeMark[] } | null = null;
  private gridCache: { key: string; value: GridLine[] } | null = null;

  invalidate(): void {
    this.marksCache = null;
    this.gridCache = null;
  }

  marks(view: RulerView): TimeMark[] {
    const interval = pickInterval(MARK_INTERVALS, view.pixelsPerSecond, 72, 14400);
    const { first, last } = this.visibleRange(view, interval);
    const key = `${interval}|${first}|${last}`;
    if (this.marksCache?.key === key) return this.marksCache.value;
    const marks: TimeMark[] = [];
    for (let time = first; time <= last && marks.length < 1200; time += interval) {
      const normalized = Number(time.toFixed(4));
      marks.push({ time: normalized, label: formatRulerTime(normalized, interval) });
    }
    this.marksCache = { key, value: marks };
    return marks;
  }

  grid(view: RulerView): GridLine[] {
    const interval = pickInterval(GRID_INTERVALS, view.pixelsPerSecond, 30, 14400);
    const { first, last } = this.visibleRange(view, interval);
    const key = `${interval}|${first}|${last}`;
    if (this.gridCache?.key === key) return this.gridCache.value;
    const lines: GridLine[] = [];
    for (let time = first; time <= last && lines.length < 2400; time += interval) {
      lines.push({ time: Number(time.toFixed(4)) });
    }
    this.gridCache = { key, value: lines };
    return lines;
  }

  private visibleRange(view: RulerView, interval: number): { first: number; last: number } {
    const duration = Math.max(view.projectDuration, view.visibleDuration, 30);
    const first = Math.floor((view.scrollOffset + 1e-9) / interval) * interval;
    const last = Math.min(duration + interval, view.scrollOffset + view.visibleDuration + interval * 2);
    return { first, last };
  }
}