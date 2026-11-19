import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../core/auth/auth.service';
import { CommandPaletteService } from '../command-palette/command-palette.service';

type RailIcon = 'home' | 'play' | 'edit' | 'tempo' | 'daw';

interface RailItem {
  label: string;
  short: string;
  path: string;
  icon: RailIcon;
}

@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './menu.component.html',
  styleUrl: './menu.component.scss',
})
export class MenuComponent {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly palette = inject(CommandPaletteService);
  private readonly destroyRef = inject(DestroyRef);

  readonly items: RailItem[] = [
    { label: 'Inicio', short: 'Inicio', path: '/', icon: 'home' },
    { label: 'Visualizador de canciones', short: 'Canciones', path: '/visualizador', icon: 'play' },
    { label: 'Modificar canciones', short: 'Editor', path: '/modificar', icon: 'edit' },
    { label: 'Metrónomo', short: 'Tempo', path: '/metronomo', icon: 'tempo' },
    { label: 'Estudio · DAW', short: 'Estudio', path: '/daw', icon: 'daw' },
  ];

  readonly activeIndex = signal(0);

  constructor() {
    this.syncActive(this.router.url);

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((event) => this.syncActive(event.urlAfterRedirects));
  }

  openPalette(): void {
    this.palette.open();
  }

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }

  private syncActive(url: string): void {
    const clean = url.split(/[?#]/, 1)[0].replace(/^\/+|\/+$/g, '');
    const index = this.items.findIndex((item) => item.path.replace(/^\/+/, '') === clean);
    this.activeIndex.set(index < 0 ? 0 : index);
  }
}
