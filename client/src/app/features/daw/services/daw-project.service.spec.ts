import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ProjectResponse, TrackResponse } from '../models/daw.models';
import { DawProjectService, TrackMeta } from './daw-project.service';

const TRACK_META: TrackMeta = {
  name: 'Voz',
  volume: 0.8,
  pan: -0.25,
  muted: false,
  solo: true,
  clip_offset: 1.5,
  clip_duration: 12,
  color: '#4f8ed8',
  source_offset: 0.5,
  pitch_semitones: -2,
};

const TRACK_RESPONSE: TrackResponse = {
  id: 42,
  project_id: 9,
  name: 'Voz',
  color: '#4f8ed8',
  audio_file_path: 'abc.wav',
  volume: 0.8,
  pan: -0.25,
  muted: false,
  solo: true,
  clip_offset: 1.5,
  clip_duration: 12,
  source_offset: 0.5,
  pitch_semitones: -2,
  created_at: '2026-01-01T00:00:00',
  updated_at: null,
};

describe('DawProjectService', () => {
  let service: DawProjectService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DawProjectService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('lists projects from the collection endpoint and tolerates an empty body', async () => {
    const request$ = service.listProjects();
    const request = httpTesting.expectOne('/api/daw/projects/');
    expect(request.request.method).toBe('GET');
    request.flush(null);

    await expect(request$).resolves.toEqual([]);
  });

  it('creates a track as multipart with every persisted field and the original audio', async () => {
    const audio = new Blob(['audio'], { type: 'audio/wav' });

    const created$ = service.createTrack(9, TRACK_META, audio, 'Voz.wav');

    const request = httpTesting.expectOne('/api/daw/projects/9/tracks/');
    expect(request.request.method).toBe('POST');
    const form = request.request.body as FormData;
    expect(form instanceof FormData).toBe(true);
    expect(form.get('name')).toBe('Voz');
    expect(form.get('volume')).toBe('0.8');
    expect(form.get('pan')).toBe('-0.25');
    expect(form.get('muted')).toBe('false');
    expect(form.get('solo')).toBe('true');
    expect(form.get('clip_offset')).toBe('1.5');
    expect(form.get('clip_duration')).toBe('12');
    expect(form.get('source_offset')).toBe('0.5');
    expect(form.get('pitch_semitones')).toBe('-2');
    expect(form.get('color')).toBe('#4f8ed8');
    expect((form.get('audio_file') as File).name).toBe('Voz.wav');

    request.flush(TRACK_RESPONSE);
    await expect(created$).resolves.toEqual(TRACK_RESPONSE);
  });

  it('does not send an empty color in the multipart payload', async () => {
    const created$ = service.createTrack(
      9,
      { ...TRACK_META, color: null },
      new Blob(['x']),
      'Voz.wav',
    );

    const request = httpTesting.expectOne('/api/daw/projects/9/tracks/');
    const form = request.request.body as FormData;
    expect(form.get('color')).toBeNull();

    request.flush(TRACK_RESPONSE);
    await created$;
  });

  it('downloads the stored audio as a blob', async () => {
    const audio$ = service.fetchTrackAudio(42);

    const request = httpTesting.expectOne('/api/daw/tracks/42/audio');
    expect(request.request.method).toBe('GET');
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['abc'], { type: 'audio/wav' }));

    const blob = await audio$;
    expect(blob.size).toBe(3);
  });

  it('prunes removed tracks one by one against the track endpoint', async () => {
    const prune$ = service.pruneTracks([7, 8]);

    httpTesting.expectOne('/api/daw/tracks/7').flush({ message: 'ok' });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    httpTesting.expectOne('/api/daw/tracks/8').flush({ message: 'ok' });

    await expect(prune$).resolves.toBeUndefined();
  });

  it('builds backend-safe wav/mp3 filenames', () => {
    expect(service.filenameFor('Voz principal', 'mp3')).toBe('Voz_principal.mp3');
    expect(service.filenameFor('Pista con acentos: ñ é', 'wav')).toBe('Pista_con_acentos_n_e.wav');
    expect(service.filenameFor('   ', 'wav')).toBe('pista.wav');
  });

  it('creates and updates project metadata through the project endpoints', async () => {
    const meta = { name: 'Maqueta', tempo: 96, time_signature: '4/4', transpose: 2 };
    const project: ProjectResponse = {
      id: 9,
      version: 1,
      ...meta,
      created_at: '2026-01-01T00:00:00',
      updated_at: null,
      tracks: [],
    };

    const created$ = service.createProject(meta);
    const create = httpTesting.expectOne('/api/daw/projects/');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual(meta);
    create.flush(project);
    await expect(created$).resolves.toEqual(project);

    const updated$ = service.updateProject(9, { tempo: 100, expected_version: 1 });
    const update = httpTesting.expectOne('/api/daw/projects/9');
    expect(update.request.method).toBe('PUT');
    expect(update.request.body).toEqual({ tempo: 100, expected_version: 1 });
    update.flush({ ...project, tempo: 100, version: 2 });
    await expect(updated$).resolves.toMatchObject({ id: 9, tempo: 100, version: 2 });
  });
});
