import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { LoginComponent } from './features/auth/pages/login/login.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: '', loadComponent: () => import('./features/home/pages/home/home.component').then(m => m.HomeComponent), canActivate: [authGuard] },
  { path: 'visualizador', loadComponent: () => import('./features/songs/pages/visualizador/visualizador.component').then(m => m.VisualizadorComponent), canActivate: [authGuard] },
  { path: 'modificar', loadComponent: () => import('./features/songs/pages/modificar/modificar.component').then(m => m.ModificarComponent), canActivate: [authGuard] },
  { path: 'metronomo', loadComponent: () => import('./features/metronome/pages/metronome/metronome.component').then(m => m.MetronomeComponent), canActivate: [authGuard] },
  { path: 'daw', loadComponent: () => import('./features/daw/daw.component').then(m => m.DawComponent), canActivate: [authGuard] },
  { path: '**', redirectTo: 'login', pathMatch: 'full' }
];