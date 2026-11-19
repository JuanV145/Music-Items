import { ChangeDetectorRef, NgZone } from '@angular/core';
import { vi } from 'vitest';
import { DawComponent } from './daw.component';
import { DawPitchService } from './services/daw-pitch.service';
import { DawProjectService } from './services/daw-project.service';
import { DawService } from './services/daw.service';

const FILE = { name: 'Voz.mp3', type: 'audio/mpeg', size: 1024 } as unknown as File;
const RECOVERY_KEY = 'daw:last-project';

function buildState(trackOverrides: Record<string, unknown> = {}): any {
  const track = {
    id: 'local-1',
    name: 'Voz',
    color: '#4f8ed8',
    file: FILE,
    audioBuffer: {} as AudioBuffer,
    originalAudioBuffer: null,
    volume: 0.8,
    pan: 0.2,
    muted: false,
    solo: false,
    waveform: [],
    clipOffset: 1,
    clipDuration: 12,
    sourceOffset: 0,
    meterLevel: 0,
    pitchSemitones: 2,
    ...trackOverrides
  };
  return {
    tracks: [track],
    tempo: 96,
    timeSignature: '4/4',
    globalTranspose: 2,
    revision: 4,
    savedRevision: 2,
    currentProjectId: undefined,
    projectName: 'Maqueta',
    audioContext: { decodeAudioData: vi.fn() },
    masterVolume: 0.8
  };
}

function buildComponent(state: any, projectService: any, pitchService: any = {}) {
  const service = {
    getState: () => state,
    setMasterVolume: vi.fn(),
    markSaved: (revision: number) => {
      state.savedRevision = revision;
      state.lastSavedAt = Date.now();
    },
    loadProject: (project: any) => {
      state.currentProjectId = project.id;
      state.projectVersion = project.version;
      state.projectName = project.name;
      state.tracks = [];
      state.revision = 0;
      state.savedRevision = 0;
      return [];
    },
    undo: vi.fn().mockReturnValue(true),
    redo: vi.fn().mockReturnValue(true),
    canUndo: false,
    canRedo: false
  } as unknown as DawService;
  const component = new DawComponent(
    service,
    pitchService as DawPitchService,
    document,
    { detectChanges: vi.fn() } as unknown as ChangeDetectorRef,
    {
      runOutsideAngular: (callback: () => void) => callback(),
      run: (callback: () => void) => callback()
    } as unknown as NgZone,
    projectService as DawProjectService
  );
  return { component, state, track: state.tracks[0] };
}

function buildProjectService(): any {
  return {
    createProject: vi.fn().mockResolvedValue({ id: 9, name: 'Maqueta', version: 1, tracks: [] }),
    updateProject: vi.fn(),
    createTrack: vi.fn().mockResolvedValue({ id: 42, audio_file_path: 'abc.mp3' }),
    updateTrack: vi.fn(),
    filenameFor: vi.fn().mockReturnValue('Voz.mp3'),
    pruneTracks: vi.fn().mockResolvedValue(undefined),
    getProject: vi.fn(),
    fetchTrackAudio: vi.fn(),
    deleteProject: vi.fn()
  };
}

/** Vacía la cola de microtareas de las promesas resueltas. */
async function flushPromises(): Promise<void> {
  for (let index = 0; index < 20; index++) await Promise.resolve();
}

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
      {} as unknown as DawPitchService,
      document,
      { detectChanges: vi.fn() } as unknown as ChangeDetectorRef,
      { runOutsideAngular: (callback: () => void) => callback() } as NgZone,
      {} as unknown as DawProjectService
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

describe('DawComponent project persistence', () => {
  it('creates the project and uploads the original audio with its pitch', async () => {
    const state = buildState();
    const projectService = buildProjectService();
    const { component, track } = buildComponent(state, projectService);

    await component.saveProject();

    expect(projectService.createProject).toHaveBeenCalledWith({
      name: 'Maqueta', tempo: 96, time_signature: '4/4', transpose: 2
    });
    expect(projectService.createTrack).toHaveBeenCalledWith(
      9,
      expect.objectContaining({
        name: 'Voz',
        clip_offset: 1,
        clip_duration: 12,
        color: '#4f8ed8',
        pitch_semitones: 2
      }),
      FILE,
      'Voz.mp3'
    );
    expect(track.serverId).toBe(42);
    expect(track.audioFilePath).toBe('abc.mp3');
    expect(projectService.pruneTracks).toHaveBeenCalledWith([]);
    expect(component.projectError).toBe('');
    expect(component.hasUnsavedChanges).toBe(false);
  });

  it('updates saved tracks and defers deletion of removed tracks to the save', async () => {
    const state = buildState({ serverId: 7, file: null });
    state.currentProjectId = 9;
    state.projectVersion = 3;
    const projectService = buildProjectService();
    projectService.updateProject.mockResolvedValue({
      id: 9,
      name: 'Maqueta',
      version: 4,
      tracks: [{ id: 7 }, { id: 8 }]
    });
    projectService.updateTrack.mockResolvedValue({ id: 7 });
    const { component } = buildComponent(state, projectService);

    await component.saveProject();

    expect(projectService.updateProject).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ name: 'Maqueta', expected_version: 3 })
    );
    expect(state.projectVersion).toBe(4);
    expect(projectService.updateTrack).toHaveBeenCalledWith(7, expect.objectContaining({ pitch_semitones: 2 }));
    expect(projectService.createTrack).not.toHaveBeenCalled();
    expect(projectService.pruneTracks).toHaveBeenCalledWith([8]);
    expect(component.hasUnsavedChanges).toBe(false);
  });
});

describe('DawComponent autosave and recovery', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('autosaves silently after the debounce and stores the session marker', async () => {
    const state = buildState();
    const projectService = buildProjectService();
    const { component } = buildComponent(state, projectService);

    (component as any).scheduleAutosave();
    await vi.advanceTimersByTimeAsync(2499);
    expect(projectService.createProject).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await flushPromises();

    expect(projectService.createProject).toHaveBeenCalledTimes(1);
    expect(state.currentProjectId).toBe(9);
    expect(state.projectVersion).toBe(1);
    expect(component.hasUnsavedChanges).toBe(false);
    expect(component.autosaveError).toBe('');
    expect(JSON.parse(localStorage.getItem(RECOVERY_KEY) as string)).toMatchObject({
      id: 9,
      name: 'Maqueta'
    });
  });

  it('restarts the debounce with every new change', async () => {
    const state = buildState();
    const projectService = buildProjectService();
    const { component } = buildComponent(state, projectService);

    (component as any).scheduleAutosave();
    await vi.advanceTimersByTimeAsync(2000);
    (component as any).scheduleAutosave();
    await vi.advanceTimersByTimeAsync(2000);
    expect(projectService.createProject).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    await flushPromises();
    expect(projectService.createProject).toHaveBeenCalledTimes(1);
  });

  it('does not autosave a clean or empty session', async () => {
    const cleanState = buildState();
    cleanState.savedRevision = cleanState.revision;
    const cleanService = buildProjectService();
    const { component: cleanComponent } = buildComponent(cleanState, cleanService);

    (cleanComponent as any).scheduleAutosave();
    await vi.advanceTimersByTimeAsync(2500);
    await flushPromises();
    expect(cleanService.createProject).not.toHaveBeenCalled();

    const emptyState = buildState();
    emptyState.tracks = [];
    emptyState.currentProjectId = undefined;
    const emptyService = buildProjectService();
    const { component: emptyComponent } = buildComponent(emptyState, emptyService);

    (emptyComponent as any).scheduleAutosave();
    await vi.advanceTimersByTimeAsync(2500);
    await flushPromises();
    expect(emptyService.createProject).not.toHaveBeenCalled();
    expect((emptyComponent as any).autosavePending).toBe(false);
  });

  it('retries with backoff and reports the offline state without alerts', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const state = buildState();
    const projectService = buildProjectService();
    projectService.createProject.mockRejectedValue(new Error('offline'));
    const { component } = buildComponent(state, projectService);

    (component as any).scheduleAutosave();
    await vi.advanceTimersByTimeAsync(2500);
    await flushPromises();

    expect(projectService.createProject).toHaveBeenCalledTimes(1);
    expect(component.autosaveError).toBe('offline');
    expect(component.projectError).toBe('');
    expect(component.projectStateLabel).toBe('Sin conexión · reintentando');
    expect(alertSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();
    expect(projectService.createProject).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(10000);
    await flushPromises();
    expect(projectService.createProject).toHaveBeenCalledTimes(3);

    alertSpy.mockRestore();
    consoleError.mockRestore();
  });

  it('stops retrying when the save fails with a non-retryable 4xx', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const state = buildState();
    const projectService = buildProjectService();
    projectService.createProject.mockRejectedValue({ status: 422, message: 'invalid' });
    const { component } = buildComponent(state, projectService);

    (component as any).scheduleAutosave();
    await vi.advanceTimersByTimeAsync(2500);
    await flushPromises();

    expect(projectService.createProject).toHaveBeenCalledTimes(1);
    expect((component as any).autosavePending).toBe(false);
    expect(component.autosaveError).toBe('');
    expect(component.projectError).toContain('No se pudo guardar el proyecto');

    await vi.advanceTimersByTimeAsync(60000);
    await flushPromises();
    expect(projectService.createProject).toHaveBeenCalledTimes(1);

    consoleError.mockRestore();
  });

  it('stops autosaving and flags a conflict when the server version changed', async () => {
    const state = buildState();
    state.currentProjectId = 9;
    state.projectVersion = 3;
    const projectService = buildProjectService();
    projectService.updateProject.mockRejectedValue({ status: 409 });
    const { component } = buildComponent(state, projectService);

    (component as any).scheduleAutosave();
    await vi.advanceTimersByTimeAsync(2500);
    await flushPromises();

    expect(projectService.updateProject).toHaveBeenCalledTimes(1);
    expect(component.projectConflict).toBe(true);
    expect(component.autosaveError).toBe('');
    expect(component.projectStateLabel).toContain('Conflicto');

    await vi.advanceTimersByTimeAsync(120000);
    await flushPromises();
    expect(projectService.updateProject).toHaveBeenCalledTimes(1);
  });

  it('overwrites with the latest server version after a conflict', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const state = buildState();
    state.currentProjectId = 9;
    state.projectVersion = 3;
    const projectService = buildProjectService();
    projectService.updateProject.mockResolvedValue({ id: 9, name: 'Maqueta', version: 6, tracks: [] });
    projectService.getProject.mockResolvedValue({ id: 9, name: 'Maqueta', version: 5, tracks: [] });
    const { component } = buildComponent(state, projectService);
    (component as any).projectConflict = true;

    await component.overwriteConflictedProject();
    await flushPromises();

    expect(projectService.getProject).toHaveBeenCalledWith(9);
    expect(projectService.updateProject).toHaveBeenLastCalledWith(
      9,
      expect.objectContaining({ expected_version: 5 })
    );
    expect(component.projectConflict).toBe(false);
    expect(state.projectVersion).toBe(6);
    expect(component.hasUnsavedChanges).toBe(false);
    confirm.mockRestore();
  });

  it('reloads the server version to resolve a conflict', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const state = buildState();
    state.currentProjectId = 9;
    state.projectVersion = 3;
    const projectService = buildProjectService();
    projectService.getProject.mockResolvedValue({
      id: 9, name: 'Maqueta', version: 7, tempo: 96, time_signature: '4/4', transpose: 0, tracks: []
    });
    const { component } = buildComponent(state, projectService);
    (component as any).projectConflict = true;

    await component.reloadConflictedProject();
    await flushPromises();

    expect(projectService.getProject).toHaveBeenCalledWith(9);
    expect(component.projectConflict).toBe(false);
    expect(state.projectVersion).toBe(7);
    expect(state.tracks).toEqual([]);
    expect(component.hasUnsavedChanges).toBe(false);
    confirm.mockRestore();
  });

  it('shows the last save time once the session is clean', async () => {
    const state = buildState();
    const projectService = buildProjectService();
    const { component } = buildComponent(state, projectService);

    await component.saveProject();

    expect(component.projectStateLabel).toMatch(/^Guardado a las /);
  });

  it('offers to recover the last session and opens it on demand', async () => {
    const savedAt = Date.now();
    localStorage.setItem(RECOVERY_KEY, JSON.stringify({ id: 9, name: 'Maqueta', savedAt }));
    const state = buildState();
    state.tracks = [];
    state.currentProjectId = undefined;
    state.revision = 0;
    state.savedRevision = 0;
    const projectService = buildProjectService();
    projectService.getProject.mockResolvedValue({
      id: 9, name: 'Maqueta', version: 5, tempo: 96, time_signature: '4/4', transpose: 0, tracks: []
    });
    const { component } = buildComponent(state, projectService);

    expect(component.recoverableProject).toMatchObject({ id: 9, name: 'Maqueta' });

    await component.recoverProject();
    await flushPromises();

    expect(projectService.getProject).toHaveBeenCalledWith(9);
    expect(state.currentProjectId).toBe(9);
    expect(state.projectVersion).toBe(5);
    expect(component.recoverableProject).toBeNull();
    expect(component.hasUnsavedChanges).toBe(false);
  });

  it('does not offer recovery when the marker belongs to the open project', () => {
    const savedAt = Date.now();
    localStorage.setItem(RECOVERY_KEY, JSON.stringify({ id: 9, name: 'Maqueta', savedAt }));
    const state = buildState();
    state.currentProjectId = 9;
    const { component } = buildComponent(state, buildProjectService());

    expect(component.recoverableProject).toBeNull();
  });

  it('discards the recovery marker without touching the server project', () => {
    localStorage.setItem(RECOVERY_KEY, JSON.stringify({ id: 9, name: 'Maqueta', savedAt: Date.now() }));
    const state = buildState();
    state.tracks = [];
    state.currentProjectId = undefined;
    const projectService = buildProjectService();
    const { component } = buildComponent(state, projectService);

    component.discardRecovery();

    expect(component.recoverableProject).toBeNull();
    expect(localStorage.getItem(RECOVERY_KEY)).toBeNull();
    expect(projectService.deleteProject).not.toHaveBeenCalled();
  });

  it('saves with Ctrl+S and ignores plain "s"', () => {
    const state = buildState();
    const { component } = buildComponent(state, buildProjectService());
    const save = vi.spyOn(component, 'saveProject').mockResolvedValue(true);

    const plain = {
      key: 's', ctrlKey: false, metaKey: false, altKey: false, preventDefault: vi.fn()
    } as unknown as KeyboardEvent;
    component.onGlobalShortcut(plain);
    expect(plain.preventDefault).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();

    const shortcut = {
      key: 's', ctrlKey: true, metaKey: false, altKey: false, preventDefault: vi.fn()
    } as unknown as KeyboardEvent;
    component.onGlobalShortcut(shortcut);
    expect(shortcut.preventDefault).toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('undoes and redoes with Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y', () => {
    const state = buildState();
    const { component } = buildComponent(state, buildProjectService());
    const service = (component as any).dawService;

    const press = (key: string, shiftKey = false) => {
      const event = { key, ctrlKey: true, metaKey: false, altKey: false, shiftKey, preventDefault: vi.fn() };
      component.onGlobalShortcut(event as unknown as KeyboardEvent);
      return event;
    };

    press('z');
    expect(service.undo).toHaveBeenCalledTimes(1);

    press('z', true);
    press('y');
    expect(service.redo).toHaveBeenCalledTimes(2);
  });

  it('leaves Ctrl+Z to the browser inside text fields', () => {
    const state = buildState();
    const { component } = buildComponent(state, buildProjectService());
    const service = (component as any).dawService;
    const input = document.createElement('input');
    const event = {
      key: 'z', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false,
      target: input, preventDefault: vi.fn()
    };

    component.onGlobalShortcut(event as unknown as KeyboardEvent);

    expect(service.undo).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
