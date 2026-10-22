export interface AudioEngine {
  context: AudioContext;
  masterGain: GainNode;
  masterAnalyser: AnalyserNode;
}

export function configureMasterCompressor(context: BaseAudioContext): DynamicsCompressorNode {
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -3;
  compressor.knee.value = 0;
  compressor.ratio.value = 20;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.12;
  return compressor;
}

/** Crea el contexto de audio y la cadena master. Devuelve null si el navegador no lo soporta. */
export function createAudioEngine(masterVolume: number): AudioEngine | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext
    || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    const context = new Ctor();
    const masterGain = context.createGain();
    const masterCompressor = configureMasterCompressor(context);
    const masterAnalyser = context.createAnalyser();
    masterAnalyser.fftSize = 512;
    masterGain.gain.value = masterVolume;
    masterGain.connect(masterCompressor);
    masterCompressor.connect(masterAnalyser);
    masterAnalyser.connect(context.destination);
    return { context, masterGain, masterAnalyser };
  } catch (error) {
    console.error('Failed to initialize Web Audio:', error);
    return null;
  }
}