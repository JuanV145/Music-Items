import {
  AfterViewChecked,
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Inject,
  NgZone,
  OnDestroy,
  ViewChild
} from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DawService } from './services/daw.service';
import { DawPitchService } from './services/daw-pitch.service';
import { shouldUpdateDawUi } from './daw-animation.utils';
import * as fader from './daw-fader.utils';
import { GridLine, RulerView, TimeMark, TimelineRuler, formatTime } from './timeline-ruler';
import { WaveformCanvasRenderer } from './waveform-canvas-renderer';
import { ClipInteractionController } from './clip-interaction.controller';
import { DawTrackPanelComponent, TrackPanelItem } from './components/daw-track-panel/daw-track-panel.component';
import { DawMixerShellComponent } from './components/daw-mixer-shell/daw-mixer-shell.component';
import {
  AudioTrack,
  MAX_FADER_DB,
  MAX_SEMITONES,
  MIN_FADER_DB,
  MIN_SEMITONES,
  PitchQuality,
  clamp,
  defaultTrackColor,
  isHexColor
} from './models/daw.models';

@Component({
  selector: 'app-daw',
  standalone: true,
  imports: [CommonModule, FormsModule, DawTrackPanelComponent, DawMixerShellComponent],
  templateUrl: './daw.component.html',
  styleUrls: ['./daw.component.scss']
})
export class DawComponent implements AfterViewInit, AfterViewChecked, OnDestroy {
  readonly Math = Math;
  readonly RULER_HEIGHT = 58;
  readonly TRACK_HEIGHT = 66;
  readonly MIN_SEMITONES = MIN_SEMITONES;
  readonly MAX_SEMITONES = MAX_SEMITONES;
  readonly FADER_STEPS = fader.FADER_STEPS;

  get state() { return this.dawService.getState(); }
  get transpose(): number { return this.state.globalTranspose; }
  get pitchProcessing(): boolean { return this.pitchService.isTransposing; }
  get pitchProgress(): string { return this.pitchService.transposeProgress; }
  get pitchError(): string { return this.pitchService.transposeError; }

  /** Devuelve las mismas referencias mientras nada cambie, para no repintar el DOM del hijo. */
  get trackPanelItems(): TrackPanelItem[] {
    const tracks = this.state.tracks;
    const previous = this.panelItemsCache;
    let allReused = previous.length === tracks.length;

    const next = tracks.map((track, index) => {
      const color = this.getTrackColor(track);
      const pitchDraft = this.getTrackPitchDraft(track.id);
      const busy = this.isTrackBusy(track.id);
      const pitchLabel = this.trackPitchLabel(track.id);
      const old = previous[index];
      if (old && old.track === track && old.index === index && old.color === color &&
          old.pitchDraft === pitchDraft && old.busy === busy && old.pitchLabel === pitchLabel) {
        return old;
      }
      allReused = false;
      return { track, index, color, pitchDraft, busy, pitchLabel };
    });

    if (allReused) return previous;
    this.panelItemsCache = next;
    return next;
  }

  // Línea de tiempo
  timelineWidth = 80;
  zoomLevel = 1;
  scrollOffset = 0;
  playheadPosition = 0;
  currentTime = 0;

  // Mezclador
  masterVolume = 0.8;
  masterMeterLevel = 0;
  mixerCollapsed = false;
  pitchDraft: number | null = null;
  private readonly qualityDraft: PitchQuality = 'High Quality';

  selectedClip: { trackId: string } | null = null;

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('timelineViewport') timelineViewport!: ElementRef<HTMLDivElement>;
  @ViewChild('playhead') playhead!: ElementRef<HTMLDivElement>;
  @ViewChild(DawTrackPanelComponent) trackPanel!: DawTrackPanelComponent;

  // Borradores de entrada (no confirmados todavía)
  private readonly trackPitchDraft = new Map<string, number>();
  private readonly trackPitchProcessing = new Set<string>();
  private readonly trackVolumeDbDraft: Record<string, string> = {};
  private masterVolumeDbDraft: string | null = null;
  private panelItemsCache: TrackPanelItem[] = [];

  // Bucle de animación
  private animationFrameId: number | null = null;
  private lastDawUiUpdate = 0;
  private lastPlayheadPx = -1;
  private loopErrors = 0;
  private uiDirty = true;
  private destroyed = false;
  private syncingScroll = false;
  private resizeObserver: ResizeObserver | null = null;
  private viewportWidthCache = 700;

  // Colaboradores extraídos
  private readonly ruler = new TimelineRuler();
  private readonly waveforms = new WaveformCanvasRenderer();
  private readonly clips: ClipInteractionController;

  // Paneo
  private readonly PAN_DRAG_PIXELS = 90;
  private readonly PAN_CENTER_SNAP = 0.03;
  private panDragTrackId: string | null = null;
  private panStartY = 0;
  private panStartValue = 0;

  constructor(
    private readonly dawService: DawService,
    private readonly pitchService: DawPitchService,
    @Inject(DOCUMENT) private readonly document: Document,
    private readonly cdr: ChangeDetectorRef,
    private readonly ngZone: NgZone
  ) {
    this.masterVolume = this.state.masterVolume ?? 0.8;
    this.dawService.setMasterVolume(this.masterVolume);
    this.clips = new ClipInteractionController(document, dawService, {
      pixelsPerSecond: () => this.pixelsPerSecond(),
      changed: () => { this.uiDirty = true; this.cdr.detectChanges(); }
    });
  }

  // ───────────────────────────── Ciclo de vida ─────────────────────────────

  ngAfterViewInit(): void {
    this.observeViewport();
    this.animatePlayhead();
    this.cdr.detectChanges();
  }

  ngAfterViewChecked(): void {
    if (this.timelineViewport) this.waveforms.draw(this.timelineViewport.nativeElement, this.state.tracks);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.clips.dispose();
  }

  private observeViewport(): void {
    const element = this.timelineViewport?.nativeElement;
    if (!element) return;
    this.viewportWidthCache = element.clientWidth || 700;
    if (typeof ResizeObserver === 'undefined') return;
    this.ngZone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => {
        this.viewportWidthCache = element.clientWidth || 700;
        this.ruler.invalidate();
        this.uiDirty = true;
      });
      this.resizeObserver.observe(element);
    });
  }

  /** Mueve el playhead siempre (barato) y solo ejecuta detectChanges cuando hay algo que repintar. */
  private animatePlayhead(): void {
    this.ngZone.runOutsideAngular(() => {
      const frame = () => {
        if (this.destroyed) return;
        this.animationFrameId = requestAnimationFrame(frame);
        try {
          this.dawService.syncPlaybackClock();
          const time = this.dawService.getCurrentTime();
          const position = this.timeToPixels(time);
          if (this.playhead && position !== this.lastPlayheadPx) {
            this.lastPlayheadPx = position;
            this.playhead.nativeElement.style.transform = `translate3d(${position}px, 0, 0)`;
          }

          const active = this.uiDirty || this.state.isPlaying || this.pitchService.isTransposing ||
            this.masterMeterLevel > 0.001 || time !== this.currentTime;

          if (active && shouldUpdateDawUi(performance.now(), this.lastDawUiUpdate)) {
            this.lastDawUiUpdate = performance.now();
            this.uiDirty = false;
            this.currentTime = time;
            this.playheadPosition = time;
            this.masterMeterLevel = this.dawService.refreshMeterLevels();
            this.cdr.detectChanges();
          }
          this.loopErrors = 0;
        } catch (error) {
          if (this.loopErrors++ < 3) console.error('Error en el bucle del playhead:', error);
          if (this.loopErrors > 200) {
            this.destroyed = true;
            if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
            console.error('Bucle del playhead detenido por errores repetidos.');
          }
        }
      };
      this.animationFrameId = requestAnimationFrame(frame);
    });
  }

  // ───────────────────────────── trackBy ─────────────────────────────

  readonly trackById = (_: number, track: AudioTrack): string => track.id;
  readonly trackByTime = (_: number, item: { time: number }): number => item.time;

  // ───────────────────────────── Importación ─────────────────────────────

  openImport(): void { this.fileInput?.nativeElement.click(); }
  addTrack(): void { this.openImport(); }

  async onFileSelect(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    for (const file of files) {
      await this.loadAudioFile(file);
      await new Promise<void>(resolve => setTimeout(resolve, 0)); // cede el hilo a la interfaz
    }
  }

  private async loadAudioFile(file: File): Promise<void> {
    const audioContext = this.state.audioContext;
    if (!audioContext) {
      this.alert('El motor de audio no está disponible en este navegador.');
      return;
    }
    try {
      const audioBuffer = await audioContext.decodeAudioData(await file.arrayBuffer());
      const trackId = this.dawService.addTrack(file.name.replace(/\.(wav|mp3)$/i, ''), audioBuffer, file);
      this.uiDirty = true;
      // Si hay un pitch global activo, solo la pista nueva se pone en ese valor.
      if (this.transpose !== 0) {
        this.pitchService.applyTransposeToTrack(trackId, this.transpose, this.qualityDraft)
          .catch(error => this.alert(`No se pudo aplicar el pitch a "${file.name}": ${this.errorMessage(error)}`));
      }
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error importing audio:', error);
      this.alert(`No se pudo importar ${file.name}: ${this.errorMessage(error)}`);
    }
  }

  // ───────────────────────────── Línea de tiempo ─────────────────────────────

  getCanvasWidth(track: AudioTrack): number {
    return Math.max(16, Math.min(8192, Math.ceil(this.timeToPixels(track.clipDuration))));
  }

  getTimelineWidth(): number {
    const duration = Math.max(this.getProjectDuration(), this.getVisibleDuration(), 30);
    return Math.max(this.viewportWidthCache, 500, this.timeToPixels(duration + 2));
  }

  getTimelineContentHeight(): number {
    return this.RULER_HEIGHT + Math.max(1, this.state.tracks.length) * this.TRACK_HEIGHT;
  }

  getVisibleDuration(): number { return this.viewportWidthCache / this.pixelsPerSecond(); }
  pixelsPerSecond(): number { return this.timelineWidth * this.zoomLevel; }
  timeToPixels(time: number): number { return Math.max(0, time) * this.pixelsPerSecond(); }
  getProjectDuration(): number { return this.dawService.getProjectDuration(); }

  private rulerView(): RulerView {
    return {
      pixelsPerSecond: this.pixelsPerSecond(),
      scrollOffset: this.scrollOffset,
      visibleDuration: this.getVisibleDuration(),
      projectDuration: this.getProjectDuration()
    };
  }

  getTimeMarks(): TimeMark[] { return this.ruler.marks(this.rulerView()); }
  getGridLines(): GridLine[] { return this.ruler.grid(this.rulerView()); }
  formatTime(seconds: number): string { return formatTime(seconds); }
  formatSemitones(value: number): string { return `${value > 0 ? '+' : ''}${value} st`; }

  onTimelineClick(event: MouseEvent): void {
    if (!this.timelineViewport) return;
    if ((event.target as HTMLElement | null)?.closest('.audio-clip')) return;
    const viewport = this.timelineViewport.nativeElement;
    const rect = viewport.getBoundingClientRect();
    const time = Math.max(0, (event.clientX - rect.left + viewport.scrollLeft) / this.pixelsPerSecond());
    this.selectedClip = null;
    this.dawService.seek(time);
    this.currentTime = this.dawService.getCurrentTime();
    this.playheadPosition = this.currentTime;
    this.uiDirty = true;
    this.cdr.detectChanges();
  }

  onTimelineScroll(): void {
    if (!this.timelineViewport || this.syncingScroll) return;
    this.syncingScroll = true;
    this.scrollOffset = this.timelineViewport.nativeElement.scrollLeft / this.pixelsPerSecond();
    this.trackPanel?.setScrollTop(this.timelineViewport.nativeElement.scrollTop);
    this.syncingScroll = false;
  }

  onTrackListScroll(scrollTop: number): void {
    if (!this.timelineViewport || this.syncingScroll) return;
    this.syncingScroll = true;
    this.timelineViewport.nativeElement.scrollTop = scrollTop;
    this.syncingScroll = false;
  }

  scrollToPlayhead(): void {
    if (!this.timelineViewport) return;
    const viewport = this.timelineViewport.nativeElement;
    const cursorX = this.timeToPixels(this.playheadPosition);
    if (cursorX < viewport.scrollLeft || cursorX > viewport.scrollLeft + viewport.clientWidth - 40) {
      viewport.scrollLeft = Math.max(0, cursorX - viewport.clientWidth * 0.2);
      this.onTimelineScroll();
    }
  }

  zoomIn(): void { this.setZoom(this.zoomLevel * 1.25); }
  zoomOut(): void { this.setZoom(this.zoomLevel / 1.4); }

  private setZoom(value: number): void {
    const viewport = this.timelineViewport?.nativeElement;
    const anchorTime = viewport ? (viewport.scrollLeft + viewport.clientWidth / 2) / this.pixelsPerSecond() : 0;
    this.zoomLevel = clamp(value, 0.02, 8);
    this.uiDirty = true;
    this.cdr.detectChanges();
    if (viewport) {
      viewport.scrollLeft = Math.max(0, this.timeToPixels(anchorTime) - viewport.clientWidth / 2);
      this.onTimelineScroll();
    }
  }

  // ───────────────────────────── Pistas y clips ─────────────────────────────

  getTrackColor(track: AudioTrack): string {
    return isHexColor(track.color) ? track.color : defaultTrackColor(track.name);
  }

  onTrackColorChange(trackId: string, color: string): void {
    if (isHexColor(color)) this.dawService.updateTrack(trackId, { color });
    this.uiDirty = true;
  }

  onTrackNameChange(trackId: string, value: string): void {
    this.dawService.updateTrack(trackId, { name: value });
    this.uiDirty = true;
  }

  toggleMute(trackId: string): void {
    const track = this.state.tracks.find(item => item.id === trackId);
    if (track) this.dawService.updateTrack(trackId, { muted: !track.muted });
    this.uiDirty = true;
  }

  toggleSolo(trackId: string): void {
    const track = this.state.tracks.find(item => item.id === trackId);
    if (track) this.dawService.updateTrack(trackId, { solo: !track.solo });
    this.uiDirty = true;
  }

  removeTrack(trackId: string): void {
    if (!this.win.confirm('¿Eliminar esta pista de la sesión?')) return;
    this.dawService.removeTrack(trackId);
    this.trackPitchDraft.delete(trackId);
    delete this.trackVolumeDbDraft[trackId];
    if (this.selectedClip?.trackId === trackId) this.selectedClip = null;
    this.uiDirty = true;
    this.cdr.detectChanges();
  }

  onClipMouseDown(event: MouseEvent, track: AudioTrack): void {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.clip-edge')) return;
    event.preventDefault();
    event.stopPropagation();
    this.selectedClip = { trackId: track.id };
    this.clips.begin(event, track, 'move');
  }

  onResizeHandleMouseDown(event: MouseEvent, track: AudioTrack, direction: 'left' | 'right'): void {
    event.preventDefault();
    event.stopPropagation();
    this.selectedClip = { trackId: track.id };
    this.clips.begin(event, track, direction === 'left' ? 'resize-left' : 'resize-right');
  }

  onClipDoubleClick(track: AudioTrack): void {
    if (!track.audioBuffer) return;
    this.dawService.updateTrack(track.id, { clipOffset: 0, sourceOffset: 0, clipDuration: track.audioBuffer.duration });
    this.selectedClip = { trackId: track.id };
    this.uiDirty = true;
    this.cdr.detectChanges();
  }

  // ───────────────────────────── Volumen ─────────────────────────────

  faderDbValue(volume: number): number { return fader.faderDbValue(volume); }
  faderPosition(volume: number): number { return fader.faderPosition(volume); }

  onTrackVolumeInput(trackId: string, event: Event): void {
    const position = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(position)) return;
    delete this.trackVolumeDbDraft[trackId];
    this.dawService.updateTrack(trackId, { volume: fader.volumeFromFaderPosition(position) });
    this.uiDirty = true;
  }

  onMasterVolumeInput(event: Event): void {
    const position = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(position)) return;
    this.masterVolumeDbDraft = null;
    this.masterVolume = fader.volumeFromFaderPosition(position);
    this.dawService.setMasterVolume(this.masterVolume);
    this.uiDirty = true;
  }

  resetTrackVolume(trackId: string, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    delete this.trackVolumeDbDraft[trackId];
    this.dawService.updateTrack(trackId, { volume: 1 }); // 0.0 dB = ganancia unidad
    this.uiDirty = true;
  }

  resetMasterVolume(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.masterVolumeDbDraft = null;
    this.masterVolume = 1;
    this.dawService.setMasterVolume(1);
    this.uiDirty = true;
  }

  trackVolumeDbText(track: AudioTrack): string {
    return this.trackVolumeDbDraft[track.id] ?? fader.faderDbValue(track.volume).toFixed(1);
  }

  setTrackVolumeDbDraft(trackId: string, value: string | number | null): void {
    this.trackVolumeDbDraft[trackId] = value === null || value === undefined ? '' : String(value);
  }

  commitTrackVolumeDb(trackId: string): void {
    const raw = this.trackVolumeDbDraft[trackId];
    if (raw === undefined) return;
    delete this.trackVolumeDbDraft[trackId];
    this.uiDirty = true;
    const decibels = Number(raw.trim());
    if (!raw.trim() || !Number.isFinite(decibels)) return;
    this.dawService.updateTrack(trackId, { volume: fader.volumeFromFaderDb(clamp(decibels, MIN_FADER_DB, MAX_FADER_DB)) });
  }

  masterVolumeDbText(): string {
    return this.masterVolumeDbDraft ?? fader.faderDbValue(this.masterVolume).toFixed(1);
  }

  setMasterVolumeDbDraft(value: string | number | null): void {
    this.masterVolumeDbDraft = value === null || value === undefined ? '' : String(value);
  }

  commitMasterVolumeDb(): void {
    if (this.masterVolumeDbDraft === null) return;
    const raw = this.masterVolumeDbDraft.trim();
    this.masterVolumeDbDraft = null;
    this.uiDirty = true;
    const decibels = Number(raw);
    if (!raw || !Number.isFinite(decibels)) return;
    this.masterVolume = fader.volumeFromFaderDb(clamp(decibels, MIN_FADER_DB, MAX_FADER_DB));
    this.dawService.setMasterVolume(this.masterVolume);
  }

  // ───────────────────────────── Paneo ─────────────────────────────

  onPanPointerDown(event: PointerEvent, trackId: string): void {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.panDragTrackId = trackId;
    this.panStartY = event.clientY;
    this.panStartValue = this.state.tracks.find(track => track.id === trackId)?.pan ?? 0;
  }

  onPanPointerMove(event: PointerEvent, trackId: string): void {
    if (this.panDragTrackId !== trackId) return;
    // Arriba = derecha, abajo = izquierda.
    const pan = clamp(this.panStartValue + (this.panStartY - event.clientY) / this.PAN_DRAG_PIXELS, -1, 1);
    this.dawService.updateTrack(trackId, { pan: Math.abs(pan) < this.PAN_CENTER_SNAP ? 0 : pan });
    this.uiDirty = true;
  }

  onPanPointerUp(event: PointerEvent): void {
    const knob = event.currentTarget as HTMLElement;
    if (knob.hasPointerCapture?.(event.pointerId)) knob.releasePointerCapture(event.pointerId);
    this.panDragTrackId = null;
  }

  centerPan(trackId: string): void {
    this.dawService.updateTrack(trackId, { pan: 0 });
    this.uiDirty = true;
  }

  onPanKeydown(event: KeyboardEvent, trackId: string): void {
    const track = this.state.tracks.find(item => item.id === trackId);
    if (!track) return;
    let next = track.pan;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= 0.05;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += 0.05;
    else if (event.key === 'Home') next = 0;
    else return;
    event.preventDefault();
    this.dawService.updateTrack(trackId, { pan: clamp(next, -1, 1) });
    this.uiDirty = true;
  }

  panLabel(pan: number): string {
    if (Math.abs(pan) < 0.005) return 'C';
    return `${pan < 0 ? 'L' : 'R'}${Math.round(Math.abs(pan) * 100)}`;
  }

  // ───────────────────────────── Pitch ─────────────────────────────

  async applyPitch(): Promise<void> {
    if (this.pitchProcessing) return;
    const raw = this.pitchDraft === null ? this.transpose : Number(this.pitchDraft);
    if (!Number.isFinite(raw)) {
      this.pitchDraft = null;
      return;
    }
    const semitones = clamp(Math.round(raw), MIN_SEMITONES, MAX_SEMITONES);
    this.pitchDraft = semitones;
    await this.pitchService.applyTranspose(semitones, this.qualityDraft);
    this.pitchDraft = null;
    this.uiDirty = true;
    this.cdr.detectChanges();
  }

  resetPitch(): void {
    this.pitchDraft = 0;
    void this.applyPitch();
  }

  /** Muestra el borrador si existe; si no, el pitch que la pista tiene realmente aplicado. */
  getTrackPitchDraft(trackId: string): number {
    return this.trackPitchDraft.get(trackId)
      ?? this.state.tracks.find(track => track.id === trackId)?.pitchSemitones
      ?? 0;
  }

  setTrackPitchDraft(trackId: string, value: number | string | null): void {
    const parsed = value === null || value === '' ? NaN : Number(value);
    if (Number.isFinite(parsed)) this.trackPitchDraft.set(trackId, parsed);
    else this.trackPitchDraft.delete(trackId);
    this.uiDirty = true;
  }

  async applyTrackPitch(trackId: string): Promise<void> {
    if (this.isTrackBusy(trackId)) return;
    const draft = this.trackPitchDraft.get(trackId);
    if (draft === undefined) return;

    const semitones = clamp(Math.round(draft), MIN_SEMITONES, MAX_SEMITONES);
    this.trackPitchProcessing.add(trackId);
    this.uiDirty = true;
    this.cdr.detectChanges();
    try {
      await this.pitchService.applyTransposeToTrack(trackId, semitones, this.qualityDraft);
    } catch (error) {
      console.error(`Error applying pitch to track ${trackId}:`, error);
      this.alert(`No se pudo aplicar el pitch a la pista: ${this.errorMessage(error)}`);
    } finally {
      this.trackPitchDraft.delete(trackId);
      this.trackPitchProcessing.delete(trackId);
      this.uiDirty = true;
      this.cdr.detectChanges();
    }
  }

  /** true si la pista está esperando en la cola o renderizándose. */
  isTrackBusy(trackId: string): boolean {
    return this.trackPitchProcessing.has(trackId) || this.pitchService.getTrackProgress(trackId) !== undefined;
  }

  /** Texto del botón: APLICAR en reposo, porcentaje mientras se procesa. */
  trackPitchLabel(trackId: string): string {
    if (!this.isTrackBusy(trackId)) return 'APLICAR';
    const progress = this.pitchService.getTrackProgress(trackId);
    return progress === undefined ? 'En cola…' : `${Math.round(progress * 100)}%`;
  }

  // ───────────────────────────── Transporte y mezclador ─────────────────────────────

  toggleMixer(): void { this.mixerCollapsed = !this.mixerCollapsed; }
  play(): void { this.uiDirty = true; void this.dawService.start(); }
  pause(): void { this.dawService.pause(); this.uiDirty = true; }
  stop(): void { this.dawService.stop(); this.uiDirty = true; }

  // ───────────────────────────── Utilidades ─────────────────────────────

  private errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
  private alert(message: string): void { this.win.alert(message); }
  private get win(): Window { return this.document.defaultView || window; }
}
