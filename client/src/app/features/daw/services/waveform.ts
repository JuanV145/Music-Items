/** Picos normalizados (0..1) en 400 divisiones, para dibujar la forma de onda. */
export function computeWaveform(buffer: AudioBuffer): number[] {
  const bins = 400;
  const waveform = new Array<number>(bins).fill(0);
  if (!buffer.length || !buffer.numberOfChannels) return waveform;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const maxSamplesPerBin = 128;
  for (let bin = 0; bin < bins; bin++) {
    const start = Math.floor((bin / bins) * buffer.length);
    const end = Math.min(buffer.length, Math.max(start + 1, Math.floor(((bin + 1) / bins) * buffer.length)));
    const step = Math.max(1, Math.ceil((end - start) / (maxSamplesPerBin - 1)));
    let peak = 0;
    for (let i = start; i < end; i += step) {
      for (const channel of channels) peak = Math.max(peak, Math.abs(channel[i]));
    }
    // Se incluye siempre el borde del bin para no perder transitorios cortos.
    for (const channel of channels) peak = Math.max(peak, Math.abs(channel[end - 1]));
    waveform[bin] = peak;
  }
  return waveform;
}