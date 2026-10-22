import { ChangeDetectorRef, NgZone } from '@angular/core';
import { vi } from 'vitest';
import { DawComponent } from './daw.component';
import { DawService } from './services/daw.service';

describe('DawComponent local audio import', () => {
  it('imports browser-decodable tracks without app file-size or duration caps', async () => {
    const buffer = { duration: 60 * 60 } as AudioBuffer;
    const audioContext = {
      decodeAudioData: vi.fn().mockResolvedValue(buffer)
    } as unknown as AudioContext;
    const state = { audioContext, masterVolume: 0.8, globalTranspose: 0 };
    const service = {
      getState: () => state,
      setMasterVolume: vi.fn(),
      addTrack: vi.fn().mockReturnValue('track-id')
    } as unknown as DawService;
    const component = new DawComponent(
      service,
      document,
      { detectChanges: vi.fn() } as unknown as ChangeDetectorRef,
      { runOutsideAngular: (callback: () => void) => callback() } as NgZone
    );
    const file = {
      name: 'concert.flac',
      type: 'audio/flac',
      size: 200 * 1024 * 1024,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(16))
    } as unknown as File;
    const input = { files: [file], value: 'selected' } as unknown as HTMLInputElement;

    await component.onFileSelect({ target: input } as unknown as Event);

    expect(audioContext.decodeAudioData).toHaveBeenCalled();
    expect(service.addTrack).toHaveBeenCalledWith('concert', buffer, file);
    expect(input.value).toBe('');
  });
});
