import { MAX_FADER_DB, MIN_FADER_DB, clamp } from './models/daw.models';

/** Resolución del <input type="range"> del fader. */
export const FADER_STEPS = 1000;
/** Imán al 0 dB: dentro de este margen el fader se queda exactamente en ganancia unidad. */
const UNITY_SNAP_DB = 0.4;

/**
 * Curva del fader (posición 0..1 de abajo hacia arriba -> dB). Reparte el recorrido como una
 * consola real: la zona útil (-12..+12 dB) ocupa la mitad superior y el 0 dB queda al 75 %.
 */
const FADER_TAPER: ReadonlyArray<readonly [db: number, position: number]> = [
  [MIN_FADER_DB, 0],
  [-36, 0.15],
  [-24, 0.30],
  [-12, 0.50],
  [0, 0.75],
  [MAX_FADER_DB, 1]
];

/** Mapea ganancia lineal al recorrido del fader (-60..+12 dB). */
export function faderDbValue(volume: number): number {
  return volume <= 0.001 ? MIN_FADER_DB : clamp(20 * Math.log10(volume), MIN_FADER_DB, MAX_FADER_DB);
}

export function volumeFromFaderDb(decibels: number): number {
  return decibels <= MIN_FADER_DB ? 0 : clamp(Math.pow(10, decibels / 20), 0, Math.pow(10, MAX_FADER_DB / 20));
}

/** Posición del fader (0..FADER_STEPS) para una ganancia lineal. */
export function faderPosition(volume: number): number {
  const db = faderDbValue(volume);
  for (let i = 1; i < FADER_TAPER.length; i++) {
    const [d0, p0] = FADER_TAPER[i - 1];
    const [d1, p1] = FADER_TAPER[i];
    if (db <= d1) return Math.round((p0 + ((db - d0) / (d1 - d0)) * (p1 - p0)) * FADER_STEPS);
  }
  return FADER_STEPS;
}

/** Ganancia lineal para una posición del fader (0..FADER_STEPS). */
export function volumeFromFaderPosition(rawPosition: number): number {
  const position = clamp(rawPosition / FADER_STEPS, 0, 1);
  let db = MAX_FADER_DB;
  for (let i = 1; i < FADER_TAPER.length; i++) {
    const [d0, p0] = FADER_TAPER[i - 1];
    const [d1, p1] = FADER_TAPER[i];
    if (position <= p1) {
      db = d0 + ((position - p0) / (p1 - p0)) * (d1 - d0);
      break;
    }
  }
  if (Math.abs(db) < UNITY_SNAP_DB) db = 0;
  return volumeFromFaderDb(db);
}
