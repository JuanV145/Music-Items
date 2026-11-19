import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DawService, configureMasterCompressor } from './daw.service';
import { computeWaveform } from './waveform';
import { vi } from 'vitest';

describe('DawService waveform generation', () => {
  it('bounds sample reads for long tracks instead of scanning every sample on the UI thread', () => {
    let sampleReads = 0;
    const source = new Float32Array(400_000);
    const samples = new Proxy(source, {
      get(target, property) {
        if (typeof property === 'string' && /^\d+$/.test(property)) sampleReads++;
        return Reflect.get(target, property);
      }
    });
    const buffer = {
      length: source.length,
      numberOfChannels: 1,
      getChannelData: () => samples
    } as unknown as AudioBuffer;
    const waveform = computeWaveform(buffer);

    expect(waveform).toHaveLength(400);
    expect(sampleReads).toBeLessThanOrEqual(400 * 128);
  });
});

describe('configureMasterCompressor', () => {
  it('uses shared peak-control settings for live and offline audio contexts', () => {
    const compressor = {
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 }
    } as unknown as DynamicsCompressorNode;
    const context = {
      createDynamicsCompressor: () => compressor
    } as unknown as BaseAudioContext;

    const configured = configureMasterCompressor(context);

    expect(configured).toBe(compressor);
    expect(compressor.threshold.value).toBe(-3);
    expect(compressor.knee.value).toBe(0);
    expect(compressor.ratio.value).toBe(20);
    expect(compressor.attack.value).toBe(0.003);
    expect(compressor.release.value).toBe(0.12);
  });
});

function buildAudioBuffer(duration = 8): AudioBuffer {
  const samples = new Float32Array(256);
  return {
    duration,
    length: samples.length,
    numberOfChannels: 1,
    sampleRate: 44100,
    getChannelData: () => samples
  } as unknown as AudioBuffer;
}

describe('DawService undo and redo', () => {
  let service: DawService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(DawService);
    service.resetProject();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('undoes and redoes track metadata changes', () => {
    const id = service.addTrack('Voz', buildAudioBuffer());
    service.updateTrack(id, { volume: 0.25 });

    expect(service.getState().tracks[0].volume).toBe(0.25);
    expect(service.canUndo).toBe(true);

    expect(service.undo()).toBe(true);
    expect(service.getState().tracks[0].volume).toBe(1);
    expect(service.canRedo).toBe(true);

    expect(service.redo()).toBe(true);
    expect(service.getState().tracks[0].volume).toBe(0.25);
  });

  it('does not add empty steps or revision bumps when nothing changes', () => {
    const id = service.addTrack('Voz', buildAudioBuffer());
    const revision = service.getState().revision;

    service.updateTrack(id, { volume: 1 });

    expect(service.getState().revision).toBe(revision);
    expect(service.undo()).toBe(true);
    expect(service.getState().tracks).toHaveLength(0);
  });

  it('groups rapid changes of the same gesture into one step', () => {
    const id = service.addTrack('Voz', buildAudioBuffer());
    for (const volume of [0.9, 0.7, 0.5, 0.3]) {
      vi.advanceTimersByTime(60);
      service.updateTrack(id, { volume });
    }

    expect(service.undo()).toBe(true);
    expect(service.getState().tracks[0].volume).toBe(1);
    expect(service.getState().tracks).toHaveLength(1);

    // El segundo paso es la importación de la pista.
    expect(service.undo()).toBe(true);
    expect(service.getState().tracks).toHaveLength(0);
  });

  it('keeps separate steps when the gesture pauses', () => {
    const id = service.addTrack('Voz', buildAudioBuffer());
    service.updateTrack(id, { volume: 0.5 });
    vi.advanceTimersByTime(600);
    service.updateTrack(id, { volume: 0.2 });

    expect(service.undo()).toBe(true);
    expect(service.getState().tracks[0].volume).toBe(0.5);
    expect(service.undo()).toBe(true);
    expect(service.getState().tracks[0].volume).toBe(1);
  });

  it('discards redo steps when a new edit arrives', () => {
    const id = service.addTrack('Voz', buildAudioBuffer());
    service.updateTrack(id, { muted: true });
    service.undo();
    expect(service.canRedo).toBe(true);

    service.updateTrack(id, { solo: true });

    expect(service.canRedo).toBe(false);
  });

  it('undoes project tempo and name edits', () => {
    service.setTempo(140);
    service.renameProject('Nueva sesión');

    expect(service.undo()).toBe(true);
    expect(service.getState().projectName).toBe('Proyecto sin título');
    expect(service.undo()).toBe(true);
    expect(service.getState().tempo).toBe(120);
  });

  it('keeps at most 50 steps in the history', () => {
    const id = service.addTrack('Voz', buildAudioBuffer());
    for (let index = 0; index < 60; index++) {
      vi.advanceTimersByTime(600);
      service.updateTrack(id, { volume: (index + 1) / 100 });
    }

    let undone = 0;
    while (service.undo()) undone++;

    expect(undone).toBe(50);
  });

  it('clears the history when the state changes outside the history (pitch)', () => {
    service.addTrack('Voz', buildAudioBuffer());
    expect(service.canUndo).toBe(true);

    service.markDirty();

    expect(service.canUndo).toBe(false);
    expect(service.canRedo).toBe(false);
  });

  it('returns false when there is nothing to undo or redo', () => {
    expect(service.undo()).toBe(false);
    expect(service.redo()).toBe(false);
  });
});