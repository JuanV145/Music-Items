import { AudioTrack } from './models/daw.models';
import { buildWaveformBars } from './waveform-render.utils';

/** Dibuja la forma de onda de cada clip y solo repinta cuando cambia algo. */
export class WaveformCanvasRenderer {
  private readonly references = new WeakMap<HTMLCanvasElement, number[] | null>();
  private readonly keys = new WeakMap<HTMLCanvasElement, string>();

  draw(root: HTMLElement, tracks: AudioTrack[]): void {
    const canvases = root.querySelectorAll<HTMLCanvasElement>('.waveform-canvas');
    if (canvases.length === 0) return;
    const tracksById = new Map(tracks.map(track => [track.id, track] as const));
    canvases.forEach(canvas => {
      const trackId = canvas.dataset['trackId'];
      const track = trackId ? tracksById.get(trackId) : undefined;
      if (track?.waveform) this.drawOne(canvas, track, track.waveform);
    });
  }

  private drawOne(canvas: HTMLCanvasElement, track: AudioTrack, points: number[]): void {
    const key = `${track.clipOffset}:${track.clipDuration}:${track.sourceOffset ?? 0}:${canvas.width}:${canvas.height}`;
    if (this.references.get(canvas) === points && this.keys.get(canvas) === key) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    const centerY = canvas.height / 2;
    const amplitude = Math.max(1, canvas.height * 0.43);
    const sourceDuration = track.audioBuffer?.duration ?? track.clipDuration;
    const sourceOffset = track.sourceOffset ?? 0;
    const startPoint = Math.min(points.length - 1, Math.floor((sourceOffset / Math.max(0.001, sourceDuration)) * points.length));
    const endPoint = Math.min(points.length, Math.max(startPoint + 1, Math.ceil(((sourceOffset + track.clipDuration) / Math.max(0.001, sourceDuration)) * points.length)));

    context.strokeStyle = 'rgba(234, 255, 244, 0.93)';
    context.lineWidth = 1;
    context.beginPath();
    for (const bar of buildWaveformBars(points, startPoint, endPoint, canvas.width)) {
      const y = bar.peak * amplitude;
      context.moveTo(bar.x, centerY - y);
      context.lineTo(bar.x, centerY + y);
    }
    context.stroke();

    context.strokeStyle = 'rgba(12, 34, 28, 0.6)';
    context.beginPath();
    context.moveTo(0, centerY + 0.5);
    context.lineTo(canvas.width, centerY + 0.5);
    context.stroke();

    this.references.set(canvas, points);
    this.keys.set(canvas, key);
  }
}