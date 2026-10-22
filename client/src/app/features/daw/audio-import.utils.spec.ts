import { describe, expect, it } from 'vitest';
import {
  getAudioDurationImportError,
  getAudioImportError,
  MAX_AUDIO_DURATION_SECONDS,
  MAX_AUDIO_FILE_SIZE
} from './audio-import.utils';

describe('getAudioImportError', () => {
  it('rejects an individual audio track larger than 50 MB before decoding', () => {
    const file = {
      name: 'long-song.mp3',
      type: 'audio/mpeg',
      size: MAX_AUDIO_FILE_SIZE + 1
    };

    expect(getAudioImportError(file)).toMatch(/50 MB/);
  });

  it('accepts a supported individual track at the 50 MB limit', () => {
    const file = { name: 'song.mp3', type: 'audio/mpeg', size: MAX_AUDIO_FILE_SIZE };

    expect(getAudioImportError(file)).toBeNull();
  });

  it('rejects a track longer than 12 minutes', () => {
    expect(getAudioDurationImportError(MAX_AUDIO_DURATION_SECONDS + 1)).not.toBeNull();
  });

  it('accepts a track exactly 12 minutes long', () => {
    expect(getAudioDurationImportError(MAX_AUDIO_DURATION_SECONDS)).toBeNull();
  });
});
