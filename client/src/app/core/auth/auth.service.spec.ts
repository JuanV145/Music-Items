import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(AuthService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('sends form credentials and stores the returned token', () => {
    service.login('ADMIN', 'nevu').subscribe();

    const request = httpTesting.expectOne('/api/auth/token');
    expect(request.request.method).toBe('POST');
    expect(request.request.body.toString()).toContain('username=ADMIN');
    expect(request.request.body.toString()).toContain('password=nevu');

    request.flush({ access_token: 'test-token', token_type: 'bearer' });
    expect(service.accessToken).toBe('test-token');
  });

  it('clears the token on logout', () => {
    sessionStorage.setItem('access_token', 'test-token');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);

    service.logout();

    expect(service.accessToken).toBeNull();
    expect(sessionStorage.getItem('access_token')).toBeNull();
  });
});
