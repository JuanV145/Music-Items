export const DAW_UI_UPDATE_INTERVAL_MS = 100;

export function shouldUpdateDawUi(now: number, lastUpdate: number): boolean {
  return now - lastUpdate >= DAW_UI_UPDATE_INTERVAL_MS;
}
