import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
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
});
