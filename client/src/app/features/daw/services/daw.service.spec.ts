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
        return Reflect.get(target, target, property);
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