import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetronomeService } from './metronome.service';

class FakeAudioContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  destination = {};
  createOscillatorCalls = 0;

  resume = vi.fn(() => Promise.resolve());
  suspend = vi.fn(() => Promise.resolve());

  createOscillator() {
    this.createOscillatorCalls++;
    return {
      type: '',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn()
    };
  }

  createGain() {
    return {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn()
      },
      connect: vi.fn()
    };
  }
}

describe('MetronomeService start/stop lifecycle', () => {
  let context: FakeAudioContext;

  beforeEach(() => {
    vi.useFakeTimers();
    context = new FakeAudioContext();
    vi.stubGlobal('AudioContext', function AudioContextMock() { return context; });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not schedule ticks when stop() happens while the context is resuming', async () => {
    let resumeAudio!: () => void;
    context.state = 'suspended';
    context.resume.mockReturnValue(new Promise<void>(resolve => { resumeAudio = resolve; }));

    const service = new MetronomeService();
    service.start(120);
    service.stop();

    resumeAudio();
    await Promise.resolve();

    expect(service.isPlaying()).toBe(false);
    expect(context.createOscillatorCalls).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the running interval on stop()', async () => {
    const service = new MetronomeService();
    service.start(120);
    await Promise.resolve();

    expect(service.isPlaying()).toBe(true);
    expect(context.createOscillatorCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    service.stop();

    expect(service.isPlaying()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
