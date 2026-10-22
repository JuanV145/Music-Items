import { Injectable } from '@angular/core';
import { DawService } from './daw.service';
import { configureMasterCompressor } from './audio-engine';
import { audioBufferToWav } from './wav-encoder';

@Injectable({ providedIn: 'root' })
export class DawExportService {
  constructor(private readonly daw: DawService) {}

  async exportMix(): Promise<Blob> {
    const state = this.daw.getState();
    const context = state.audioContext;
    if (!context || !state.tracks.some(track => !!track.audioBuffer)) {
      throw new Error('No hay pistas de audio para exportar o el motor de audio no está disponible.');
    }
    const duration = this.daw.getProjectDuration();
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('La sesión no tiene duración exportable.');

    const sampleRate = context.sampleRate;
    const frameCount = Math.max(1, Math.ceil(sampleRate * duration));
    const Offline = window.OfflineAudioContext
      || (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!Offline) throw new Error('Este navegador no soporta exportación de audio offline.');

    const offline = new Offline(2, frameCount, sampleRate);
    const masterGain = offline.createGain();
    const masterCompressor = configureMasterCompressor(offline);
    masterGain.gain.setValueAtTime(state.masterVolume, 0);
    masterGain.connect(masterCompressor);
    masterCompressor.connect(offline.destination);
    const anySolo = state.tracks.some(track => track.solo);

    for (const track of state.tracks) {
      const audioBuffer = track.audioBuffer;
      if (!audioBuffer || track.clipDuration <= 0) continue;
      if (track.muted || (anySolo && !track.solo)) continue;
      const sourceOffset = Math.max(0, track.sourceOffset ?? 0);
      const clipLength = Math.min(track.clipDuration, audioBuffer.duration - sourceOffset);
      if (clipLength <= 0 || sourceOffset >= audioBuffer.duration) continue;

      const source = offline.createBufferSource();
      source.buffer = audioBuffer;
      const gainNode = offline.createGain();
      const panNode = offline.createStereoPanner();
      source.connect(gainNode);
      gainNode.connect(panNode);
      panNode.connect(masterGain);
      gainNode.gain.setValueAtTime(track.volume, 0);
      panNode.pan.setValueAtTime(track.pan, 0);
      source.start(track.clipOffset, sourceOffset, clipLength);
    }
    return audioBufferToWav(await offline.startRendering());
  }
}