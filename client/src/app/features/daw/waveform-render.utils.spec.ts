import { describe, expect, it } from 'vitest';
import { buildWaveformBars } from './waveform-render.utils';

describe('buildWaveformBars', () => {
  it('bounds render work by available waveform samples even for very wide clips', () => {
    const bars = buildWaveformBars(new Array(400).fill(0.5), 0, 400, 8192);

    expect(bars).toHaveLength(400);
    expect(bars[0].x).toBeGreaterThanOrEqual(0);
    expect(bars.at(-1)?.x).toBeLessThan(8192);
    expect(bars.every(bar => bar.peak === 0.5)).toBe(true);
  });

  it('aggregates waveform samples when the clip is narrower than the source envelope', () => {
    const bars = buildWaveformBars([0.1, 0.8, 0.2, 0.4], 0, 4, 2);

    expect(bars.map(bar => bar.peak)).toEqual([0.8, 0.4]);
  });
});
