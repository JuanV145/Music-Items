# Refactor DAW

Copia el contenido de `client/` sobre tu proyecto (misma ruta: client/src/app/features/daw/).

Archivos NUEVOS:
  daw-fader.utils.ts, timeline-ruler.ts, waveform-canvas-renderer.ts, clip-interaction.controller.ts
  services/audio-engine.ts, waveform.ts, wav-encoder.ts, daw-pitch.service.ts, daw-export.service.ts

Archivos REEMPLAZADOS:
  daw.component.ts, services/daw.service.ts, components/daw-track-panel/daw-track-panel.component.ts

Sin cambios de lógica: components/daw-mixer-shell/daw-mixer-shell.component.ts

Pasos manuales:
 1. daw-track-panel.component.html: *ngFor="let item of items; trackBy: trackByItem"
 2. Las llamadas a pitch (applyTranspose, applyTransposeToTrack, resetTranspose, transposeUp/Down,
    isTransposing, transposeProgress, transposeError, getTrackProgress) ahora están en DawPitchService.
 3. dawService.exportMix() ahora es DawExportService.exportMix().
 4. dawService.computeWaveform() ahora es computeWaveform de services/waveform.ts.
 5. Mantén provideHttpClient() en app.config.ts (DawPitchService usa HttpClient).
