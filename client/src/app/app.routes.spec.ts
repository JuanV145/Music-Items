import { routes } from './app.routes';
import { authGuard } from './core/auth/auth.guard';

describe('app routes', () => {
  it('lazy-loads the DAW page to keep audio code out of the initial bundle', () => {
    const dawRoute = routes.find(route => route.path === 'daw');

    expect(dawRoute?.loadComponent).toBeDefined();
    expect(dawRoute?.component).toBeUndefined();
  });

  it('lazy-loads feature pages instead of importing them into the initial bundle', () => {
    for (const path of ['', 'visualizador', 'modificar', 'metronomo']) {
      const route = routes.find(candidate => candidate.path === path);
      expect(route?.loadComponent, `${path || 'home'} should be lazy-loaded`).toBeDefined();
      expect(route?.component).toBeUndefined();
    }
  });

  it('keeps login public and protects the song and DAW pages', () => {
    const loginRoute = routes.find(route => route.path === 'login');
    const protectedPaths = ['', 'visualizador', 'modificar', 'metronomo', 'daw'];

    expect(loginRoute).toBeDefined();
    expect(loginRoute?.canActivate).toBeUndefined();
    for (const path of protectedPaths) {
      expect(routes.find(route => route.path === path)?.canActivate).toContain(authGuard);
    }
  });
});
