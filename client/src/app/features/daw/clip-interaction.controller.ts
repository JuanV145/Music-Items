import { AudioTrack, ClipInteraction, clamp } from './models/daw.models';
import { DawService } from './services/daw.service';

export interface ClipInteractionHost {
  pixelsPerSecond(): number;
  /** Se llama tras cada cambio para que el componente repinte. */
  changed(): void;
}

/** Gestiona el arrastre (mover / redimensionar) de un clip con listeners de documento. */
export class ClipInteractionController {
  private mode: ClipInteraction | null = null;
  private trackId: string | null = null;
  private startX = 0;
  private startClipOffset = 0;
  private startDuration = 0;
  private startSourceOffset = 0;
  private wasPlaying = false;

  private readonly onMove = (event: MouseEvent) => this.handleMove(event);
  private readonly onUp = () => this.handleUp();

  constructor(
    private readonly document: Document,
    private readonly daw: DawService,
    private readonly host: ClipInteractionHost
  ) {}

  begin(event: MouseEvent, track: AudioTrack, mode: ClipInteraction): void {
    this.mode = mode;
    this.trackId = track.id;
    this.startX = event.clientX;
    this.startClipOffset = track.clipOffset;
    this.startDuration = track.clipDuration;
    this.startSourceOffset = track.sourceOffset ?? 0;
    this.wasPlaying = this.daw.getState().isPlaying;
    this.document.addEventListener('mousemove', this.onMove);
    this.document.addEventListener('mouseup', this.onUp);
  }

  dispose(): void {
    this.document.removeEventListener('mousemove', this.onMove);
    this.document.removeEventListener('mouseup', this.onUp);
  }

  private handleMove(event: MouseEvent): void {
    if (!this.mode || !this.trackId) return;
    const track = this.daw.getState().tracks.find(item => item.id === this.trackId);
    if (!track?.audioBuffer) return;
    const sourceLength = track.audioBuffer.duration;
    const delta = (event.clientX - this.startX) / this.host.pixelsPerSecond();

    if (this.mode === 'move') {
      this.daw.updateTrack(track.id, { clipOffset: Math.max(0, this.startClipOffset + delta) });
    } else if (this.mode === 'resize-right') {
      const maxDuration = Math.max(0.05, sourceLength - (track.sourceOffset ?? 0));
      this.daw.updateTrack(track.id, { clipDuration: clamp(this.startDuration + delta, 0.05, maxDuration) });
    } else {
      const end = this.startClipOffset + this.startDuration;
      const start = Math.max(0, Math.min(end - 0.05, this.startClipOffset + delta));
      const sourceOffset = clamp(this.startSourceOffset + (start - this.startClipOffset), 0, sourceLength - 0.05);
      const duration = Math.max(0.05, Math.min(sourceLength - sourceOffset, end - start));
      this.daw.updateTrack(track.id, { clipOffset: start, sourceOffset, clipDuration: duration });
    }
    this.host.changed();
  }

  private handleUp(): void {
    const shouldResume = this.wasPlaying;
    const current = this.daw.getCurrentTime();
    this.mode = null;
    this.trackId = null;
    this.dispose();
    if (shouldResume) this.daw.seek(current, true);
  }
}