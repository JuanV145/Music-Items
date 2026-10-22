import { HttpClient } from '@angular/common/http';
import { Injectable, OnDestroy } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AudioTrack, MAX_SEMITONES, MIN_SEMITONES, PitchQuality, clamp } from '../models/daw.models';
import { DawService } from './daw.service';
import { PitchShifter } from './pitch-shifter';
import { computeWaveform } from './waveform';

const yieldToBrowser = (): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, 0));

@Injectable({ providedIn: 'root' })
export class DawPitchService implements OnDestroy {
  private readonly apiUrl = '/api';
  /** Progreso (0..1) del render de pitch de cada pista que se está procesando. */
  private readonly trackProgress = new Map<string, number>();

  // Cola de trabajos: se ejecutan de uno en uno, nunca se pisan.
  private pitchQueue: Promise<void> = Promise.resolve();
  private activeJobs = 0;
  /** Se incrementa para cancelar todos los trabajos en curso o encolados. */
  private generation = 0;
  private shifter: PitchShifter | null = null;

  transposeError = '';
  /** Progreso legible mostrado en el control de pitch. */
  transposeProgress = '';

  constructor(private readonly daw: DawService, private readonly http: HttpClient) {}

  /** true mientras haya algún trabajo de pitch (global o de pista) en curso o en cola. */
  get isTransposing(): boolean { return this.activeJobs > 0; }

  getTrackProgress(trackId: string): number | undefined { return this.trackProgress.get(trackId); }

  /** Pitch global: pone TODAS las pistas en este valor (sobrescribe los ajustes manuales previos). */
  applyTranspose(semitones: number, quality: PitchQuality = 'High Quality'): Promise<void> {
    const target = clamp(Math.round(semitones), MIN_SEMITONES, MAX_SEMITONES);
    return this.enqueue(async isCancelled => {
      const state = this.daw.getState();
      const previous = state.globalTranspose;
      const pending = this.tracksPendingRender(target);
      this.transposeError = '';
      state.globalTranspose = target;
      if (pending.length === 0) {
        this.transposeProgress = '';
        return;
      }

      await this.withPlaybackPaused(async () => {
        const total = pending.length;
        try {
          for (let index = 0; index < total; index++) {
            if (isCancelled()) return;
            const track = pending[index];
            const label = `Pista ${index + 1}/${total}: ${track.name}`;
            this.transposeProgress = `Cargando fuente ${index + 1}/${total}: ${track.name}`;
            await yieldToBrowser();
            const done = await this.renderTrack(track, target, quality, isCancelled, fraction => {
              this.transposeProgress = `${label} · ${Math.round(fraction * 100)}%`;
            });
            if (!done) return;
          }
        } catch (error) {
          console.error('Could not apply pitch shift:', error);
          this.transposeError = error instanceof Error ? error.message : 'Error al procesar el audio';
          state.globalTranspose = previous;
        } finally {
          this.transposeProgress = '';
        }
      });
    });
  }

  /** Pone UNA pista en un pitch propio (valor absoluto en semitonos). Lanza error si falla. */
  applyTransposeToTrack(trackId: string, semitones: number, quality: PitchQuality = 'High Quality'): Promise<void> {
    const target = clamp(Math.round(semitones), MIN_SEMITONES, MAX_SEMITONES);
    return this.enqueue(async isCancelled => {
      const track = this.daw.getState().tracks.find(item => item.id === trackId);
      if (!track) throw new Error(`No existe la pista ${trackId}.`);
      if (track.pitchSemitones === target) return;

      this.transposeError = '';
      await this.withPlaybackPaused(async () => {
        try {
          this.transposeProgress = `Procesando pista ${track.name}…`;
          await yieldToBrowser();
          await this.renderTrack(track, target, quality, isCancelled, fraction => {
            this.transposeProgress = `Pista ${track.name} · ${Math.round(fraction * 100)}%`;
          });
        } catch (error) {
          this.transposeError = error instanceof Error ? error.message : 'Error al procesar el audio';
          throw error;
        } finally {
          this.transposeProgress = '';
        }
      });
    });
  }

  resetTranspose(): void { void this.applyTranspose(0); }
  transposeUp(): void { void this.applyTranspose(this.daw.getState().globalTranspose + 1); }
  transposeDown(): void { void this.applyTranspose(this.daw.getState().globalTranspose - 1); }

  ngOnDestroy(): void { this.generation++; }

  // ───────────────────────────── Internos ─────────────────────────────

  private getShifter(): PitchShifter {
    if (!this.shifter) this.shifter = new PitchShifter(this.daw.requireContext());
    return this.shifter;
  }

  private tracksPendingRender(semitones: number): AudioTrack[] {
    return this.daw.getState().tracks.filter(track =>
      !!track.audioBuffer && this.hasRecoverableOriginal(track) && track.pitchSemitones !== semitones);
  }

  /** Renderiza una pista al pitch indicado y confirma el resultado de forma atómica. */
  private async renderTrack(
    track: AudioTrack,
    semitones: number,
    quality: PitchQuality,
    isCancelled: () => boolean,
    onProgress: (fraction: number) => void
  ): Promise<boolean> {
    this.trackProgress.set(track.id, 0);
    try {
      // Si el PCM original fue liberado, se recarga desde el File o desde el backend.
      const original = await this.getOriginalAudioBuffer(track);
      if (isCancelled()) return false;
      await yieldToBrowser();

      const shifted = semitones === 0
        ? original
        : await this.getShifter().shift(original, semitones, {
            mode: PitchShifter.detectMode(track.name),
            quality,
            isCancelled,
            onProgress: fraction => {
              this.trackProgress.set(track.id, fraction);
              onProgress(fraction);
            }
          });
      if (isCancelled()) return false;
      if (!shifted) throw new Error(`El procesamiento de pitch no generó audio para la pista "${track.name}".`);
      if (shifted.length !== original.length || shifted.numberOfChannels !== original.numberOfChannels) {
        throw new Error(`El audio procesado de "${track.name}" tiene una duración o canales inesperados.`);
      }

      track.audioBuffer = shifted;
      // Si el original se puede recuperar, se libera para ahorrar RAM; si no, se conserva para poder resetear.
      track.originalAudioBuffer = semitones === 0 || !this.canReloadOriginal(track) ? original : null;
      track.waveform = computeWaveform(shifted);
      track.clipDuration = Math.min(track.clipDuration, Math.max(0, shifted.duration - track.sourceOffset));
      track.pitchSemitones = semitones;
      return true;
    } finally {
      this.trackProgress.delete(track.id);
    }
  }

  private enqueue(job: (isCancelled: () => boolean) => Promise<void>): Promise<void> {
    const generation = this.generation;
    const isCancelled = () => generation !== this.generation;
    this.activeJobs++;
    const run = this.pitchQueue.then(() => (isCancelled() ? undefined : job(isCancelled)));
    this.pitchQueue = run.then(() => undefined, () => undefined);
    return run.finally(() => { this.activeJobs--; });
  }

  /** Pausa la reproducción mientras dura la tarea y la reanuda en el mismo punto. */
  private async withPlaybackPaused(task: () => Promise<void>): Promise<void> {
    this.daw.suspendForProcessing();
    try {
      await task();
    } finally {
      await this.daw.resumeAfterProcessing();
    }
  }

  private canReloadOriginal(track: AudioTrack): boolean { return !!track.file || !!track.audioFilePath; }
  private hasRecoverableOriginal(track: AudioTrack): boolean {
    return !!track.originalAudioBuffer || this.canReloadOriginal(track);
  }

  private async getOriginalAudioBuffer(track: AudioTrack): Promise<AudioBuffer> {
    if (track.originalAudioBuffer) return track.originalAudioBuffer;
    const context = this.daw.requireContext();
    if (track.file) return context.decodeAudioData(await track.file.arrayBuffer());
    if (track.serverId) return this.fetchAudioBuffer(track.serverId, track.name);
    if (track.audioBuffer && track.pitchSemitones === 0) return track.audioBuffer;
    throw new Error(`No se puede recuperar el audio original de "${track.name}". Importa de nuevo el archivo para aplicar otro pitch.`);
  }

  private async fetchAudioBuffer(trackId: number, name: string): Promise<AudioBuffer> {
    const blob = await firstValueFrom(
      this.http.get(`${this.apiUrl}/daw/tracks/${trackId}/audio`, { responseType: 'blob' })
    );
    if (!blob) throw new Error(`No se pudo recuperar el audio de la pista "${name}".`);
    return this.daw.requireContext().decodeAudioData(await blob.arrayBuffer());
  }
}
