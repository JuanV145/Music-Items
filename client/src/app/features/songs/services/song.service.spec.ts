import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Song } from '../models/song.model';
import { SongService } from './song.service';

describe('SongService', () => {
  let service: SongService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(SongService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('loads the song collection without triggering a slash redirect', async () => {
    const songsPromise = service.getSongs();

    const request = httpTesting.expectOne('/api/songs/');
    expect(request.request.method).toBe('GET');
    request.flush([]);

    await expect(songsPromise).resolves.toEqual([]);
  });

  it('updates an existing song with PUT and a clean payload', async () => {
    const song: Song = {
      id: 7,
      created_at: '2026-01-01T00:00:00',
      title: 'Canción editada',
      artist: 'Artista',
      key_root: 'D',
      key_mode: 'm',
      tempo: '90',
      time_signature: '3/4',
      structure: 'Verso',
      chords_lyrics: '[VERSO]\nD   A\nLetra'
    };

    const updatePromise = service.updateSong(7, song);

    const request = httpTesting.expectOne('/api/songs/7');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      title: 'Canción editada',
      artist: 'Artista',
      key_root: 'D',
      key_mode: 'm',
      tempo: '90',
      time_signature: '3/4',
      structure: 'Verso',
      chords_lyrics: '[VERSO]\nD   A\nLetra'
    });
    expect(request.request.body).not.toHaveProperty('id');
    expect(request.request.body).not.toHaveProperty('created_at');

    request.flush({ ...song });
    await expect(updatePromise).resolves.toEqual(song);
  });

  it('sends null for empty artist and structure when updating', async () => {
    const song: Song = {
      title: 'Sin artista',
      key_root: 'C',
      key_mode: '',
      tempo: '120',
      time_signature: '4/4',
      chords_lyrics: 'C'
    };

    const updatePromise = service.updateSong(3, song);

    const request = httpTesting.expectOne('/api/songs/3');
    expect(request.request.body.artist).toBeNull();
    expect(request.request.body.structure).toBeNull();
    request.flush({ ...song, id: 3, created_at: '2026-01-01T00:00:00' });

    await expect(updatePromise).resolves.toMatchObject({ id: 3 });
  });
});
