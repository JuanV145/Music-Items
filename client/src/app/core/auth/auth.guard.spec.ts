import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { authGuard } from './auth.guard';

describe('authGuard', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('redirects unauthenticated users to login with their return URL', () => {
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url: '/modificar' } as RouterStateSnapshot),
    ) as UrlTree;

    expect(TestBed.inject(Router).serializeUrl(result)).toBe('/login?returnUrl=%2Fmodificar');
  });

  it('allows authenticated users through', () => {
    sessionStorage.setItem('access_token', 'test-token');

    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url: '/modificar' } as RouterStateSnapshot),
    );

    expect(result).toBe(true);
  });
});
