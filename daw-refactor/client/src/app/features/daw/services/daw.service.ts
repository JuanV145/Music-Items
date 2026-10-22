import { Injectable, OnDestroy } from '@angular/core';
import {
  DawState,
  MAX_FADER_DB,
  PlaybackNode,
  TrackChanges,
  clamp,
  defaultTrackColor
} from '../models/daw.models';
import { createAudioEngine } from './audio-engine';
import { computeWaveform } from './waveform';

// Se re-exporta para no romper importaciones existentes.
export { configureMasterCompressor } from './audio-engine';

@Injectable({ providedIn: 'root' })
export class DawService implements OnDestroy {
  private readonly state: DawState = {
    tracks: [],
    tempo: 120,
    timeSignature: '4/4',
    isPlaying: false,
    currentTime: 0,
    audioContext: null,
    masterGain: null,
    masterAnalyser: null,
    masterVolume: 0.8,
    playbackNodes: new Map<string, PlaybackNode>(),
    globalTranspose: 0,
    currentProjectId: undefined
  };

  /** Ganancia lineal equivalente a +12 dB. */
  private readonly maxGain = Math.pow(10, MAX_FADER_DB / 20);
  private readonly meterBuffer = new Float32Array(512);

  private playbackStartedAt = 0;
  private playbackStartPosition = 0;
  /** Posición a la que reanudar tras una tarea larga (null = no reanudar). */
  private resumePosition: number | null = null;

  constructor() {
    this.initAudioContext();
  }

  // ───────────────────────────── Motor de audio ─────────────────────────────

  private initAudioContext(): void {
    const engine = createAudioEngine(this.state.masterVolume);
    this.state.audioContext = engine?.context ?? null;
    this.state.masterGain = engine?.masterGain ?? null;
    this.state.masterAnalyser = engine?.masterAnalyser ?? null;
  }

  requireContext(): AudioContext {
    const context = this.state.audioContext;
    if (!context) throw new Error('El motor de audio no está disponible.');
    return context;
  }

  getState(): DawState { return this.state; }
  getCurrentTime(): number { return this.state.isPlaying ? this.calculatePlaybackTime() : this.state.currentTime; }

  getProjectDuration(): number {
    return this.state.tracks.reduce((max, track) => track.audioBuffer
      ? Math.max(max, track.clipOffset + track.clipDuration)
      : max, 0);
  }

  // ───────────────────────────── Pistas ─────────────────────────────

  addTrack(name: string, audioBuffer: AudioBuffer, file: File | null = null): string {
    const id = this.createId();
    this.state.tracks.push({
      id,
      name,
      color: defaultTrackColor(name),
      file,
      audioBuffer,
      originalAudioBuffer: audioBuffer,
      volume: 1,
      pan: 0,
      muted: false,
      solo: false,
      waveform: computeWaveform(audioBuffer),
      clipOffset: 0,
      clipDuration: audioBuffer.duration,
      sourceOffset: 0,
      meterLevel: 0,
      pitchSemitones: 0
    });
    return id;
  }

  removeTrack(id: string): void {
    const node = this.state.playbackNodes.get(id);
    if (node) this.stopAndDisconnectNode(node);
    this.state.playbackNodes.delete(id);
    this.state.tracks = this.state.tracks.filter(track => track.id !== id);
    this.refreshTrackGains();
  }

  updateTrack(id: string, changes: TrackChanges): void {
    const track = this.state.tracks.find(item => item.id === id);
    if (!track) return;

    const safe = { ...changes };
    if (safe.volume !== undefined) safe.volume = clamp(safe.volume, 0, this.maxGain);
    if (safe.pan !== undefined) safe.pan = clamp(safe.pan, -1, 1);
    if (safe.clipOffset !== undefined) safe.clipOffset = Math.max(0, safe.clipOffset);
    if (safe.clipDuration !== undefined) safe.clipDuration = Math.max(0, safe.clipDuration);
    if (safe.sourceOffset !== undefined) safe.sourceOffset = Math.max(0, safe.sourceOffset);
    Object.assign(track, safe);

    // Solo es un comportamiento de grupo: un cambio puede afectar a la ganancia de todos los canales.
    if (this.state.isPlaying) this.refreshTrackGains();
  }

  // ───────────────────────────── Transporte ─────────────────────────────

  async start(position = this.state.currentTime): Promise<void> {
    const context = this.state.audioContext;
    if (!context || this.state.tracks.length === 0 || this.state.isPlaying) return;
    if (context.state === 'suspended') await context.resume();

    const duration = this.getProjectDuration();
    if (duration <= 0) return;
    position = clamp(position, 0, duration);
    if (position >= duration) {
      this.state.currentTime = 0;
      position = 0;
    }

    if (!this.state.masterGain || !this.state.masterAnalyser) this.initAudioContext();
    if (!this.state.masterGain || !this.state.masterAnalyser || !this.state.audioContext) return;

    this.clearPlaybackNodes();
    this.state.masterGain.gain.setValueAtTime(this.state.masterVolume, context.currentTime);
    this.playbackStartPosition = position;
    this.playbackStartedAt = context.currentTime;
    this.state.currentTime = position;
    this.state.isPlaying = true;
    const anySolo = this.state.tracks.some(track => track.solo);

    for (const track of this.state.tracks) {
      const audioBuffer = track.audioBuffer;
      if (!audioBuffer || track.clipDuration <= 0) continue;
      const audible = !track.muted && (!anySolo || track.solo);
      const clipEnd = track.clipOffset + track.clipDuration;
      if (clipEnd <= position) continue;

      const elapsedInClip = Math.max(0, position - track.clipOffset);
      const when = context.currentTime + Math.max(0, track.clipOffset - position);
      const sourceStart = Math.max(0, (track.sourceOffset ?? 0) + elapsedInClip);
      const requestedDuration = Math.max(0, track.clipDuration - elapsedInClip);
      const sourceDuration = Math.min(requestedDuration, audioBuffer.duration - sourceStart);
      if (sourceDuration <= 0.001 || sourceStart >= audioBuffer.duration) continue;

      const source = context.createBufferSource();
      source.buffer = audioBuffer;
      const gainNode = context.createGain();
      const panNode = context.createStereoPanner();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      gainNode.gain.setValueAtTime(audible ? track.volume : 0, context.currentTime);
      panNode.pan.setValueAtTime(track.pan, context.currentTime);
      source.connect(gainNode);
      gainNode.connect(panNode);
      panNode.connect(analyser);
      analyser.connect(this.state.masterGain);
      this.state.playbackNodes.set(track.id, { source, gainNode, panNode, analyser });
      source.start(when, sourceStart, sourceDuration);
    }
  }

  pause(): void {
    this.resumePosition = null;
    if (!this.state.isPlaying) return;
    this.syncPlaybackClock();
    if (!this.state.isPlaying) return;
    this.state.isPlaying = false;
    this.clearPlaybackNodes();
  }

  stop(resetPosition = true): void {
    this.state.isPlaying = false;
    this.resumePosition = null;
    this.clearPlaybackNodes();
    if (resetPosition) this.state.currentTime = 0;
  }

  seek(position: number, resume = this.state.isPlaying): void {
    const nextPosition = clamp(Number.isFinite(position) ? position : 0, 0, this.getProjectDuration());
    this.stop(false);
    this.state.currentTime = nextPosition;
    this.playbackStartPosition = nextPosition;
    if (resume && this.state.tracks.length > 0) void this.start(nextPosition);
  }

  /** Detiene la reproducción para una tarea larga (p. ej. render de pitch) recordando dónde estaba. */
  suspendForProcessing(): void {
    if (!this.state.isPlaying) return;
    const position = this.getCurrentTime();
    this.resumePosition = position;
    this.state.currentTime = position;
    this.state.isPlaying = false;
    this.clearPlaybackNodes();
  }

  /** Reanuda tras `suspendForProcessing`, salvo que el usuario haya pausado/detenido entretanto. */
  async resumeAfterProcessing(): Promise<void> {
    const resumeAt = this.resumePosition;
    this.resumePosition = null;
    if (resumeAt === null) return;
    try { await this.start(resumeAt); }
    catch (error) { console.error('No se pudo reanudar la reproducción tras cambiar el pitch:', error); }
  }

  syncPlaybackClock(): void {
    if (!this.state.isPlaying || !this.state.audioContext) return;
    const current = this.calculatePlaybackTime();
    const duration = this.getProjectDuration();
    if (current >= duration) {
      this.stop(false);
      this.state.currentTime = duration;
      return;
    }
    this.state.currentTime = current;
  }

  private calculatePlaybackTime(): number {
    const context = this.state.audioContext;
    if (!context || !this.state.isPlaying) return this.state.currentTime;
    return Math.max(0, this.playbackStartPosition + (context.currentTime - this.playbackStartedAt));
  }

  // ───────────────────────────── Mezclador ─────────────────────────────

  setTempo(tempo: number): void { this.state.tempo = clamp(Math.round(tempo), 20, 300); }

  setMasterVolume(volume: number): void {
    this.state.masterVolume = clamp(volume, 0, this.maxGain);
    const context = this.state.audioContext;
    if (this.state.masterGain && context) {
      this.state.masterGain.gain.setTargetAtTime(this.state.masterVolume, context.currentTime, 0.012);
    }
  }

  private refreshTrackGains(): void {
    const context = this.state.audioContext;
    if (!context) return;
    const anySolo = this.state.tracks.some(track => track.solo);
    for (const track of this.state.tracks) {
      const node = this.state.playbackNodes.get(track.id);
      if (!node) continue;
      const audible = !track.muted && (!anySolo || track.solo);
      node.gainNode.gain.setTargetAtTime(audible ? track.volume : 0, context.currentTime, 0.012);
      node.panNode.pan.setTargetAtTime(track.pan, context.currentTime, 0.012);
    }
  }

  /** Actualiza los medidores RMS reales. Devuelve el nivel del Master. */
  refreshMeterLevels(): number {
    for (const track of this.state.tracks) {
      const playback = this.state.playbackNodes.get(track.id);
      track.meterLevel = playback ? this.measureRms(playback.analyser) : 0;
    }
    return this.state.masterAnalyser ? this.measureRms(this.state.masterAnalyser) : 0;
  }

  private measureRms(analyser: AnalyserNode): number {
    const data = this.meterBuffer.length >= analyser.fftSize ? this.meterBuffer : new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < analyser.fftSize; i++) sum += data[i] * data[i];
    return clamp(Math.sqrt(sum / Math.max(1, analyser.fftSize)) * 2.2, 0, 1);
  }

  private clearPlaybackNodes(): void {
    for (const node of this.state.playbackNodes.values()) this.stopAndDisconnectNode(node);
    this.state.playbackNodes.clear();
    for (const track of this.state.tracks) track.meterLevel = 0;
  }

  private stopAndDisconnectNode(node: PlaybackNode): void {
    node.source.onended = null;
    try { node.source.stop(); } catch { /* ya terminó */ }
    try { node.source.disconnect(); } catch { /* ya desconectado */ }
    try { node.gainNode.disconnect(); } catch { /* ya desconectado */ }
    try { node.panNode.disconnect(); } catch { /* ya desconectado */ }
    try { node.analyser.disconnect(); } catch { /* ya desconectado */ }
  }

  ngOnDestroy(): void {
    this.stop();
    if (this.state.audioContext) void this.state.audioContext.close();
  }

  private createId(): string {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 11)}`;
  }
}
