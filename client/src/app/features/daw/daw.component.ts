import {
  AfterViewChecked,
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  Inject,
  NgZone,
  OnDestroy,
  ViewChild
} from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DawService, LoadedTrackPitch } from './services/daw.service';
import { DawPitchService } from './services/daw-pitch.service';
import { DawProjectService, ProjectMeta, TrackMeta } from './services/daw-project.service';
import { audioBufferToWav } from './services/wav-encoder';
import { shouldUpdateDawUi } from './daw-animation.utils';
import * as fader from './daw-fader.utils';
import { GridLine, RulerView, TimeMark, TimelineRuler, formatTime } from './timeline-ruler';
import { WaveformCanvasRenderer } from './waveform-canvas-renderer';
import { ClipInteractionController } from './clip-interaction.controller';
import { DawTrackPanelComponent, TrackPanelItem } from './components/daw-track-panel/daw-track-panel.component';
import { DawMixerShellComponent } from './components/daw-mixer-shell/daw-mixer-shell.component';
import { DawProjectDialogComponent } from './components/daw-project-dialog/daw-project-dialog.component';
import {
  AudioTrack,
  MAX_FADER_DB,
  MAX_SEMITONES,
  MIN_FADER_DB,
  MIN_SEMITONES,
  PitchQuality,
  ProjectResponse,
  clamp,
  defaultTrackColor,
  isHexColor
} from './models/daw.models';

/** Espera tras el último cambio persistible antes de autoguardar. */
const AUTOSAVE_DELAY_MS = 2500;
/** Backoff de los reintentos de autoguardado: 5 s → 60 s. */
const AUTOSAVE_RETRY_MIN_MS = 5000;
const AUTOSAVE_RETRY_MAX_MS = 60000;
/** Marcador (solo metadatos) de la última sesión guardada en este navegador. */
const RECOVERY_STORAGE_KEY = 'daw:last-project';

interface RecoveryMarker {
  id: number;
  name: string;
  savedAt: number;
}

@Component({
  selector: 'app-daw',
  standalone: true,
  imports: [CommonModule, FormsModule, DawTrackPanelComponent, DawMixerShellComponent, DawProjectDialogComponent],
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

  get hasUnsavedChanges(): boolean {
    return (this.state.revision ?? 0) !== (this.state.savedRevision ?? 0);
  }

  get canUndo(): boolean { return this.dawService.canUndo; }
  get canRedo(): boolean { return this.dawService.canRedo; }

  get projectStateLabel(): string {
    if (this.projectError) return this.projectError;
    if (this.isSavingProject) return 'Guardando…';
    if (this.isLoadingProject) return 'Abriendo proyecto…';
    if (this.projectConflict) return 'Conflicto: el proyecto cambió en otra pestaña';
    if (this.autosaveError) return 'Sin conexión · reintentando';
    if (this.hasUnsavedChanges) return 'Cambios sin guardar';
    const savedAt = this.state.lastSavedAt;
    if (typeof savedAt === 'number' && Number.isFinite(savedAt)) return `Guardado a las ${this.clockLabel(savedAt)}`;
    return this.state.currentProjectId ? 'Guardado' : 'Proyecto nuevo';
  }

  /**
   * Devuelve las mismas referencias mientras nada cambie, para no repintar el DOM del hijo.
   * `name`, `muted` y `solo` son instantáneas: aunque la pista se mute en el mezclador, el
   * panel solo se refresca cuando alguno de estos valores cambia y le llega un array nuevo.
   */
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
      if (old && old.track === track && old.index === index && old.name === track.name && old.color === color &&
          old.muted === track.muted && old.solo === track.solo &&
          old.pitchDraft === pitchDraft && old.busy === busy && old.pitchLabel === pitchLabel) {
        return old;
      }
      allReused = false;
      return { track, index, name: track.name, color, muted: track.muted, solo: track.solo, pitchDraft, busy, pitchLabel };
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

  // Proyecto y persistencia
  projectDialogOpen = false;
  projects: ProjectResponse[] = [];
  projectsLoading = false;
  projectBusy = false;
  projectError = '';
  isSavingProject = false;
  isLoadingProject = false;

  /** `true` si el servidor tiene una versión más reciente que la sesión local. */
  projectConflict = false;
  conflictBusy = false;

  // Autoguardado y recuperación de la última sesión
  recoverableProject: RecoveryMarker | null = null;
  autosaveError = '';
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private autosaveRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private autosaveRetryDelay = 0;
  private autosavePending = false;
  private autosaveSuspended = false;
  /** `false` cuando el último fallo no se arregla reintentando (p. ej. un 4xx). */
  private autosaveRetryable = true;
  /** Última revisión observada por el bucle de animación. */
  private lastObservedRevision = -1;

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
    private readonly ngZone: NgZone,
    private readonly projectService: DawProjectService
  ) {
    this.masterVolume = this.state.masterVolume ?? 0.8;
    this.dawService.setMasterVolume(this.masterVolume);
    this.clips = new ClipInteractionController(document, dawService, {
      pixelsPerSecond: () => this.pixelsPerSecond(),
      changed: () => { this.uiDirty = true; this.cdr.detectChanges(); }
    });
    this.lastObservedRevision = this.state.revision;
    this.detectRecoverableSession();
  }

  // ───────────────────────────── Ciclo de vida ─────────────────────────────

  ngAfterViewInit(): void {
    // Si al volver al DAW quedaron cambios pendientes (falló el guardado al salir),
    // el primer frame del bucle los detecta y vuelve a programar el autoguardado.
    this.lastObservedRevision = this.hasUnsavedChanges ? -1 : this.state.revision;
    this.observeViewport();
    this.animatePlayhead();
    this.cdr.detectChanges();
  }

  ngAfterViewChecked(): void {
    if (this.timelineViewport) this.waveforms.draw(this.timelineViewport.nativeElement, this.state.tracks);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.clearAutosaveTimer();
    this.clearAutosaveRetryTimer();
    // Si había cambios esperando el debounce, se intentan guardar al salir.
    this.flushPendingAutosave();
    this.dawService.stop();
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
          // Cualquier cambio persistible incrementa `revision`: se programa el autoguardado.
          if (!this.autosaveSuspended && this.state.revision !== this.lastObservedRevision) {
            this.lastObservedRevision = this.state.revision;
            this.uiDirty = true;
            this.scheduleAutosave();
          }
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
      const trackId = this.dawService.addTrack(file.name.replace(/\.(wav|mp3|flac|ogg|oga|m4a|aac|aif|aiff|opus|webm)$/i, ''), audioBuffer, file);
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

  // ───────────────────────────── Proyectos guardados ─────────────────────────────

  onProjectNameChange(value: string): void {
    this.dawService.renameProject(value ?? '');
    this.uiDirty = true;
  }

  openProjectDialog(): void {
    this.projectDialogOpen = true;
    this.projectError = '';
    void this.refreshProjects();
  }

  closeProjectDialog(): void {
    this.projectDialogOpen = false;
  }

  async refreshProjects(): Promise<void> {
    this.projectsLoading = true;
    this.projectError = '';
    this.uiDirty = true;
    this.cdr.detectChanges();
    try {
      this.projects = await this.projectService.listProjects();
    } catch (error) {
      console.error('Error loading DAW projects:', error);
      this.projectError = `No se pudieron cargar los proyectos: ${this.errorMessage(error)}`;
    } finally {
      this.projectsLoading = false;
      this.uiDirty = true;
      this.cdr.detectChanges();
    }
  }

  /**
   * Guarda metadatos del proyecto, crea las pistas nuevas y poda las eliminadas.
   * En modo `silent` (autoguardado) no muestra alertas: el error queda en `autosaveError`.
   */
  async saveProject(options: { silent?: boolean } = {}): Promise<boolean> {
    const silent = options.silent === true;
    if (this.isSavingProject || this.isLoadingProject) return false;
    if (this.pitchProcessing) {
      if (!silent) this.alert('Espera a que termine el procesado de pitch antes de guardar.');
      return false;
    }
    const state = this.state;
    if (state.tracks.length === 0 && state.currentProjectId === undefined) {
      if (!silent) this.alert('Añade al menos una pista antes de guardar el proyecto.');
      return false;
    }

    const revision = state.revision;
    this.isSavingProject = true;
    if (!silent) this.projectError = '';
    this.refreshView();

    try {
      const meta: ProjectMeta = {
        name: state.projectName.trim() || 'Proyecto sin título',
        tempo: state.tempo,
        time_signature: state.timeSignature,
        transpose: state.globalTranspose
      };
      const project = state.currentProjectId !== undefined
        ? await this.projectService.updateProject(
            state.currentProjectId,
            state.projectVersion !== undefined
              ? { ...meta, expected_version: state.projectVersion }
              : meta
          )
        : await this.projectService.createProject(meta);

      state.currentProjectId = project.id;
      state.projectVersion = project.version;
      state.projectName = project.name;

      const keptTrackIds: number[] = [];
      for (const track of state.tracks) {
        const trackMeta = this.trackMeta(track);
        if (track.serverId !== undefined) {
          try {
            await this.projectService.updateTrack(track.serverId, trackMeta);
            keptTrackIds.push(track.serverId);
            continue;
          } catch (error) {
            // La pista se borró en el servidor (p. ej. se eliminó y se deshizo el borrado):
            // se vuelve a crear en lugar de fallar el guardado completo.
            if ((error as { status?: number } | null)?.status !== 404) throw error;
            track.serverId = undefined;
            track.audioFilePath = undefined;
          }
        }
        const audio = await this.audioPayloadFor(track);
        const saved = await this.projectService.createTrack(
          project.id,
          trackMeta,
          audio.blob,
          this.projectService.filenameFor(track.name, audio.extension)
        );
        track.serverId = saved.id;
        track.audioFilePath = saved.audio_file_path;
        keptTrackIds.push(saved.id);
      }

      // Las pistas quitadas de la sesión se borran solo al confirmar el guardado.
      const staleTrackIds = project.tracks
        .map(track => track.id)
        .filter(id => !keptTrackIds.includes(id));
      await this.projectService.pruneTracks(staleTrackIds);

      // Si el usuario siguió editando durante la subida, la sesión sigue "sucia".
      this.dawService.markSaved(revision);
      this.projectError = '';
      this.autosaveError = '';
      this.autosaveRetryable = true;
      this.projectConflict = false;
      this.writeRecoveryMarker();
      // La sesión guardada pasa a ser la actual: el aviso de recuperación ya no aplica.
      this.recoverableProject = null;
      return true;
    } catch (error) {
      if ((error as { status?: number } | null)?.status === 409) {
        this.handleProjectConflict();
        return false;
      }
      console.error('Error saving DAW project:', error);
      const message = this.errorMessage(error);
      if (silent) {
        this.autosaveError = message;
        this.autosaveRetryable = this.isRetryableSaveError(error);
      } else {
        this.projectError = `No se pudo guardar el proyecto: ${message}`;
      }
      return false;
    } finally {
      this.isSavingProject = false;
      this.refreshView();
    }
  }

  async loadSelectedProject(project: ProjectResponse): Promise<void> {
    if (this.isLoadingProject || this.isSavingProject) return;
    if (this.pitchProcessing) {
      this.projectError = 'Espera a que termine el procesado de pitch antes de abrir otro proyecto.';
      this.cdr.detectChanges();
      return;
    }
    if (this.hasUnsavedChanges && !this.win.confirm('Hay cambios sin guardar. ¿Descartarlos y abrir otro proyecto?')) return;
    await this.loadProjectById(project.id);
  }

  /** Descarga y abre un proyecto por id. Devuelve `true` solo si la sesión quedó cargada. */
  private async loadProjectById(
    projectId: number,
    options: { scheduleAutosaveOnFailure?: boolean } = {}
  ): Promise<boolean> {
    if (this.isLoadingProject || this.isSavingProject) return false;
    if (this.pitchProcessing) {
      this.projectError = 'Espera a que termine el procesado de pitch antes de abrir otro proyecto.';
      this.refreshView();
      return false;
    }

    const context = this.state.audioContext;
    if (!context) {
      this.projectError = 'El motor de audio no está disponible en este navegador.';
      this.refreshView();
      return false;
    }

    const recovering = this.recoverableProject?.id === projectId;
    this.suspendAutosave();
    this.isLoadingProject = true;
    this.projectError = '';
    this.refreshView();

    try {
      // La lista puede venir resumida: se pide el proyecto completo antes de abrirlo.
      const full = await this.projectService.getProject(projectId);
      const buffers = new Map<number, AudioBuffer>();
      for (const track of full.tracks) {
        const blob = await this.projectService.fetchTrackAudio(track.id);
        buffers.set(track.id, await context.decodeAudioData(await blob.arrayBuffer()));
      }

      const pitches: LoadedTrackPitch[] = this.dawService.loadProject(full, buffers);
      this.resetLocalDrafts();
      this.projectDialogOpen = false;
      this.lastObservedRevision = this.state.revision;
      this.refreshView();

      await this.reapplySavedPitch(pitches);
      this.dawService.markSaved(this.state.revision);
      this.autosaveError = '';
      this.autosaveRetryable = true;
      this.projectConflict = false;
      this.writeRecoveryMarker();
      this.recoverableProject = null;
      return true;
    } catch (error) {
      console.error('Error opening DAW project:', error);
      const message = this.errorMessage(error);
      this.projectError = recovering
        ? `No se pudo recuperar la sesión anterior: ${message}`
        : `No se pudo abrir el proyecto: ${message}`;
      return false;
    } finally {
      this.isLoadingProject = false;
      this.resumeAutosave();
      // Si abrir falló y la sesión actual tenía cambios, se sigue intentando guardarlos.
      if (options.scheduleAutosaveOnFailure !== false && this.hasUnsavedChanges) this.scheduleAutosave();
      this.refreshView();
    }
  }

  newProject(): void {
    if (this.isSavingProject) return;
    if (this.pitchProcessing) {
      this.projectError = 'Espera a que termine el procesado de pitch antes de crear otro proyecto.';
      this.cdr.detectChanges();
      return;
    }
    if (this.hasUnsavedChanges && !this.win.confirm('Hay cambios sin guardar. ¿Crear un proyecto nuevo y descartarlos?')) return;
    this.cancelPendingAutosave();
    this.autosaveError = '';
    this.projectConflict = false;
    this.conflictBusy = false;
    this.dawService.resetProject();
    this.lastObservedRevision = this.state.revision;
    this.resetLocalDrafts();
    this.projectDialogOpen = false;
    this.projectError = '';
    this.refreshView();
  }

  async deleteProject(project: ProjectResponse): Promise<void> {
    if (this.projectBusy) return;
    if (!this.win.confirm(`¿Eliminar el proyecto "${project.name}"? Esta acción no se puede deshacer.`)) return;

    this.projectBusy = true;
    this.projectError = '';
    this.uiDirty = true;
    this.cdr.detectChanges();
    try {
      await this.projectService.deleteProject(project.id);
      this.projects = this.projects.filter(item => item.id !== project.id);
      if (this.recoverableProject?.id === project.id) this.recoverableProject = null;
      if (this.readRecoveryMarker()?.id === project.id) this.clearRecoveryMarker();
      if (this.state.currentProjectId === project.id) {
        this.cancelPendingAutosave();
        this.projectConflict = false;
        this.dawService.resetProject();
        this.lastObservedRevision = this.state.revision;
        this.resetLocalDrafts();
      }
    } catch (error) {
      console.error('Error deleting DAW project:', error);
      this.projectError = `No se pudo eliminar el proyecto: ${this.errorMessage(error)}`;
    } finally {
      this.projectBusy = false;
      this.uiDirty = true;
      this.cdr.detectChanges();
    }
  }

  /** Los cambios de pitch son persistibles: se re-renderizan al abrir el proyecto. */
  private async reapplySavedPitch(pitches: LoadedTrackPitch[]): Promise<void> {
    for (const { trackId, semitones } of pitches) {
      if (semitones === 0) continue;
      try {
        await this.pitchService.applyTransposeToTrack(trackId, semitones, this.qualityDraft);
      } catch (error) {
        console.error(`Could not restore pitch for track ${trackId}:`, error);
        this.projectError = `El proyecto se abrió, pero no se pudo restaurar el pitch de una pista: ${this.errorMessage(error)}`;
      }
    }
  }

  private trackMeta(track: AudioTrack): TrackMeta {
    return {
      name: track.name.trim().slice(0, 200) || 'Pista',
      volume: track.volume,
      pan: track.pan,
      muted: track.muted,
      solo: track.solo,
      clip_offset: Math.max(0, track.clipOffset),
      clip_duration: Math.max(0.01, track.clipDuration),
      color: isHexColor(track.color) ? track.color : null,
      source_offset: Math.max(0, track.sourceOffset),
      pitch_semitones: clamp(Math.round(track.pitchSemitones), MIN_SEMITONES, MAX_SEMITONES)
    };
  }

  /**
   * Devuelve el audio ORIGINAL de la pista para subirlo junto a `pitch_semitones`.
   * WAV y MP3 se envían tal cual; el resto se recodifica a WAV.
   */
  private async audioPayloadFor(track: AudioTrack): Promise<{ blob: Blob; extension: 'wav' | 'mp3' }> {
    const file = track.file;
    const fileExtension = file ? /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() : undefined;
    if (file && (fileExtension === 'wav' || fileExtension === 'mp3')) {
      const type = fileExtension === 'mp3' ? 'audio/mpeg' : 'audio/wav';
      return { blob: file.type === type ? file : new Blob([file], { type }), extension: fileExtension };
    }

    const context = this.state.audioContext;
    let original = track.originalAudioBuffer;
    if (!original && file && context) original = await context.decodeAudioData(await file.arrayBuffer());
    if (!original) original = track.audioBuffer;
    if (!original) throw new Error(`La pista "${track.name}" no tiene audio que guardar.`);
    return { blob: audioBufferToWav(original), extension: 'wav' };
  }

  private resetLocalDrafts(): void {
    this.trackPitchDraft.clear();
    this.trackPitchProcessing.clear();
    for (const key of Object.keys(this.trackVolumeDbDraft)) delete this.trackVolumeDbDraft[key];
    this.masterVolumeDbDraft = null;
    this.pitchDraft = null;
    this.selectedClip = null;
    this.panelItemsCache = [];
  }

  // ───────────────────────────── Autoguardado ─────────────────────────────

  /** Programa un guardado silencioso tras el debounce; cada edición lo reinicia. */
  private scheduleAutosave(): void {
    if (this.destroyed || this.autosaveSuspended || this.projectConflict) return;
    this.autosavePending = true;
    this.clearAutosaveTimer();
    this.clearAutosaveRetryTimer();
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      void this.runAutosave();
    }, AUTOSAVE_DELAY_MS);
  }

  private async runAutosave(): Promise<void> {
    if (this.destroyed || this.autosaveSuspended || this.projectConflict) {
      this.autosavePending = false;
      return;
    }
    // Si hay otra operación en curso (guardado manual, apertura o pitch), se espera.
    if (this.isSavingProject || this.isLoadingProject || this.pitchProcessing) {
      this.scheduleAutosave();
      return;
    }
    if (!this.hasUnsavedChanges) {
      this.autosavePending = false;
      this.autosaveError = '';
      this.autosaveRetryable = true;
      return;
    }
    const state = this.state;
    if (state.tracks.length === 0 && state.currentProjectId === undefined) {
      // Proyecto vacío: no hay nada persistible todavía.
      this.autosavePending = false;
      return;
    }

    const saved = await this.saveProject({ silent: true });
    if (this.autosaveSuspended || this.destroyed) {
      this.autosavePending = false;
      return;
    }
    if (!saved) {
      if (this.projectConflict) {
        // El conflicto necesita decisión del usuario: no se reintenta solo.
        this.autosavePending = false;
        return;
      }
      if (this.hasUnsavedChanges && this.autosaveRetryable) {
        this.scheduleAutosaveRetry();
      } else {
        // Error no recuperable (validación, permisos…): se muestra y se deja de reintentar.
        this.autosavePending = false;
        if (this.hasUnsavedChanges) {
          this.projectError = `No se pudo guardar el proyecto: ${this.autosaveError}`;
          this.autosaveError = '';
        }
      }
      return;
    }

    this.autosavePending = false;
    this.autosaveError = '';
    this.autosaveRetryDelay = 0;
    // El usuario pudo seguir editando mientras se subía el proyecto.
    if (this.hasUnsavedChanges) this.scheduleAutosave();
  }

  /** Reintento con backoff exponencial (5 s → 60 s) tras fallar el autoguardado. */
  private scheduleAutosaveRetry(): void {
    this.clearAutosaveRetryTimer();
    this.autosaveRetryDelay = Math.min(
      Math.max(this.autosaveRetryDelay * 2, AUTOSAVE_RETRY_MIN_MS),
      AUTOSAVE_RETRY_MAX_MS
    );
    this.autosavePending = true;
    this.autosaveRetryTimer = setTimeout(() => {
      this.autosaveRetryTimer = null;
      void this.runAutosave();
    }, this.autosaveRetryDelay);
    this.refreshView();
  }

  private cancelPendingAutosave(): void {
    this.autosavePending = false;
    this.autosaveRetryDelay = 0;
    this.clearAutosaveTimer();
    this.clearAutosaveRetryTimer();
  }

  private suspendAutosave(): void {
    this.autosaveSuspended = true;
    this.cancelPendingAutosave();
  }

  private resumeAutosave(): void {
    this.autosaveSuspended = false;
    this.lastObservedRevision = this.state.revision;
  }

  private clearAutosaveTimer(): void {
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
  }

  private clearAutosaveRetryTimer(): void {
    if (this.autosaveRetryTimer !== null) clearTimeout(this.autosaveRetryTimer);
    this.autosaveRetryTimer = null;
  }

  /** Intenta guardar lo que quedaba pendiente al destruir el componente. */
  private flushPendingAutosave(): void {
    if (!this.autosavePending || !this.hasUnsavedChanges) return;
    // Fire-and-forget: el estado vive en DawService y sobrevive a la navegación.
    void this.saveProject({ silent: true });
  }

  // ───────────────────────────── Recuperación ─────────────────────────────

  /** Recupera desde el banner la última sesión guardada en este navegador. */
  async recoverProject(): Promise<void> {
    const marker = this.recoverableProject;
    if (!marker || this.isLoadingProject || this.isSavingProject) return;
    if (this.hasUnsavedChanges &&
        !this.win.confirm('Hay cambios sin guardar en la sesión actual. ¿Descartarlos y recuperar la sesión anterior?')) {
      return;
    }
    const recovered = await this.loadProjectById(marker.id);
    if (recovered) {
      this.recoverableProject = null;
      this.refreshView();
    }
  }

  /** Descarta el aviso y olvida el marcador (no borra el proyecto del servidor). */
  discardRecovery(): void {
    this.clearRecoveryMarker();
    this.recoverableProject = null;
    this.refreshView();
  }

  // ───────────────────────────── Conflicto de versión ─────────────────────────────

  /** El servidor rechazó el guardado porque otra sesión ya escribió una versión nueva. */
  private handleProjectConflict(): void {
    this.projectConflict = true;
    this.autosavePending = false;
    this.autosaveError = '';
    this.autosaveRetryable = false;
    this.clearAutosaveTimer();
    this.clearAutosaveRetryTimer();
    this.refreshView();
  }

  /** Descarta los cambios locales y abre la versión que hay en el servidor. */
  async reloadConflictedProject(): Promise<void> {
    const projectId = this.state.currentProjectId;
    if (projectId === undefined || this.isLoadingProject || this.isSavingProject || this.conflictBusy) return;
    if (!this.win.confirm('Se descartarán los cambios locales sin guardar. ¿Recargar la versión del servidor?')) return;

    this.conflictBusy = true;
    this.projectConflict = false;
    try {
      const loaded = await this.loadProjectById(projectId, { scheduleAutosaveOnFailure: false });
      if (!loaded) this.handleProjectConflict();
    } finally {
      this.conflictBusy = false;
      this.refreshView();
    }
  }

  /** Fuerza el guardado: adopta la versión actual del servidor y sube la sesión local. */
  async overwriteConflictedProject(): Promise<void> {
    const projectId = this.state.currentProjectId;
    if (projectId === undefined || this.isLoadingProject || this.isSavingProject || this.conflictBusy) return;
    if (!this.win.confirm('Se sobrescribirá la versión del servidor con la sesión actual. ¿Continuar?')) return;

    this.conflictBusy = true;
    this.projectError = '';
    try {
      const latest = await this.projectService.getProject(projectId);
      this.state.projectVersion = latest.version;
      this.projectConflict = false;
      this.autosaveRetryable = true;
      const saved = await this.saveProject();
      if (!saved && !this.projectConflict && !this.projectError) {
        this.projectError = 'No se pudo sobrescribir el proyecto.';
      }
    } catch (error) {
      console.error('Error resolving DAW project conflict:', error);
      this.projectError = `No se pudo recuperar la versión del servidor: ${this.errorMessage(error)}`;
      this.projectConflict = true;
    } finally {
      this.conflictBusy = false;
      this.refreshView();
    }
  }

  formatRecoveredAt(timestamp: number): string {
    try {
      return new Date(timestamp).toLocaleString([], {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '';
    }
  }

  /** Solo se ofrece recuperar cuando no hay ya una sesión activa. */
  private detectRecoverableSession(): void {
    const marker = this.readRecoveryMarker();
    if (!marker) return;
    if (this.state.currentProjectId === marker.id) return;
    if (this.state.tracks.length > 0) return;
    this.recoverableProject = marker;
  }

  private writeRecoveryMarker(): void {
    const id = this.state.currentProjectId;
    const storage = this.localStorageRef;
    if (id === undefined || !storage) return;
    const marker: RecoveryMarker = {
      id,
      name: this.state.projectName,
      savedAt: this.state.lastSavedAt ?? Date.now()
    };
    try {
      storage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(marker));
    } catch {
      // Almacenamiento lleno o bloqueado: el autoguardado sigue funcionando sin marcador.
    }
  }

  private readRecoveryMarker(): RecoveryMarker | null {
    try {
      const raw = this.localStorageRef?.getItem(RECOVERY_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<RecoveryMarker> | null;
      if (typeof parsed?.id !== 'number' || typeof parsed.name !== 'string' || typeof parsed.savedAt !== 'number') {
        return null;
      }
      return { id: parsed.id, name: parsed.name, savedAt: parsed.savedAt };
    } catch {
      return null;
    }
  }

  private clearRecoveryMarker(): void {
    try {
      this.localStorageRef?.removeItem(RECOVERY_STORAGE_KEY);
    } catch {
      // Sin almacenamiento disponible: nada que limpiar.
    }
  }

  private get localStorageRef(): Storage | null {
    try {
      return this.win.localStorage ?? null;
    } catch {
      return null;
    }
  }

  private clockLabel(timestamp: number): string {
    try {
      return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  /** Marca la vista como sucia y la repinta, salvo que el componente ya esté destruido. */
  private refreshView(): void {
    this.uiDirty = true;
    if (!this.destroyed) this.cdr.detectChanges();
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.hasUnsavedChanges) return;
    event.preventDefault();
    event.returnValue = '';
  }

  /** Ctrl+S / Cmd+S guarda igual que el botón, sin abrir el diálogo del navegador. */
  @HostListener('window:keydown', ['$event'])
  onGlobalShortcut(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();

    if (key === 's') {
      event.preventDefault();
      void this.saveProject();
      return;
    }

    // Dentro de un campo de texto, deshacer/rehacer pertenece al navegador.
    if (key === 'z' || key === 'y') {
      if (this.isEditableTarget(event.target)) return;
      event.preventDefault();
      if (key === 'y' || event.shiftKey) this.redo();
      else this.undo();
    }
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    if (!element || typeof element.tagName !== 'string') return false;
    return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable;
  }

  // ───────────────────────────── Deshacer / rehacer ─────────────────────────────

  undo(): void {
    if (this.pitchProcessing) return;
    if (!this.dawService.undo()) return;
    this.afterHistoryChange();
  }

  redo(): void {
    if (this.pitchProcessing) return;
    if (!this.dawService.redo()) return;
    this.afterHistoryChange();
  }

  /** Las instantáneas reemplazan las pistas: los borradores y la selección dejan de valer. */
  private afterHistoryChange(): void {
    this.resetLocalDrafts();
    this.refreshView();
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
      viewport.scrollLeft = Math.max(0, this.timeToPixels(anchorTime) - viewport.clientWidth * 0.2);
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

  /**
   * Solo se reintenta lo que puede mejorar solo: red caída (status 0), timeouts,
   * límite de peticiones y errores 5xx. Un 4xx requiere que el usuario actúe.
   */
  private isRetryableSaveError(error: unknown): boolean {
    const status = (error as { status?: number } | null | undefined)?.status;
    if (status === undefined || status === 0) return true;
    return status >= 500 || status === 408 || status === 429;
  }

  private alert(message: string): void { this.win.alert(message); }
  private get win(): Window { return this.document.defaultView || window; }
}