import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { CommandPaletteService } from './command-palette.service';

interface PaletteItem {
  id: string;
  index: string;
  label: string;
  hint: string;
  keywords: string;
  path?: string;
  action?: 'logout';
}

const ITEMS: PaletteItem[] = [
  {
    id: 'inicio',
    index: '01',
    label: 'Inicio',
    hint: 'Panel principal',
    keywords: 'inicio home panel portada',
    path: '/',
  },
  {
    id: 'visualizador',
    index: '02',
    label: 'Visualizador de canciones',
    hint: 'Escuchar · acordes',
    keywords: 'visualizador canciones escuchar reproductor letras',
    path: '/visualizador',
  },
  {
    id: 'modificar',
    index: '03',
    label: 'Modificar canciones',
    hint: 'Editor · tonalidad',
    keywords: 'modificar editor tonalidad transportar letras acordes',
    path: '/modificar',
  },
  {
    id: 'metronomo',
    index: '04',
    label: 'Metrónomo',
    hint: 'Tempo · compás',
    keywords: 'metronomo tempo bpm compas pulso ritmo',
    path: '/metronomo',
  },
  {
    id: 'daw',
    index: '05',
    label: 'Estudio · DAW',
    hint: 'Pistas · mezcla',
    keywords: 'daw estudio pistas mezcla grabar audio',
    path: '/daw',
  },
  {
    id: 'logout',
    index: '••',
    label: 'Cerrar sesión',
    hint: 'Salir del estudio',
    keywords: 'cerrar sesion salir logout',
    action: 'logout',
  },
];

const normalize = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

@Component({
  selector: 'app-command-palette',
  standalone: true,
  templateUrl: './command-palette.component.html',
  styleUrl: './command-palette.component.scss',
  host: {
    '(document:keydown)': 'onDocumentKeydown($event)',
  },
})
export class CommandPaletteComponent {
  private readonly palette = inject(CommandPaletteService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly isOpen = this.palette.isOpen;
  readonly query = signal('');
  readonly selected = signal(0);

  private lastFocused: HTMLElement | null = null;

  readonly filtered = computed(() => {
    const tokens = normalize(this.query()).trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return ITEMS;

    return ITEMS.filter((item) => {
      const haystack = normalize(`${item.label} ${item.hint} ${item.keywords}`);
      return tokens.every((token) => haystack.includes(token));
    });
  });

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        this.lastFocused = document.activeElement as HTMLElement | null;
        this.query.set('');
        this.selected.set(0);
        requestAnimationFrame(() => this.searchInput()?.nativeElement.focus());
        return;
      }

      // Al cerrar, devolvemos el foco a donde estaba para no perder el contexto.
      const target = this.lastFocused;
      this.lastFocused = null;

      if (target && document.contains(target)) {
        requestAnimationFrame(() => target.focus({ preventScroll: true }));
      }
    });
  }

  onDocumentKeydown(event: KeyboardEvent): void {
    const isPaletteKey =
      event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey);

    if (isPaletteKey) {
      event.preventDefault();
      this.palette.toggle();
      return;
    }

    if (event.key === 'Escape' && this.isOpen()) {
      event.preventDefault();
      this.palette.close();
    }
  }

  onQueryInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.selected.set(0);
  }

  onInputKeydown(event: KeyboardEvent): void {
    const items = this.filtered();

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.move(1, items.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.move(-1, items.length);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const item = items[this.selected()];
      if (item) this.run(item);
    }
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.palette.close();
  }

  hover(index: number): void {
    this.selected.set(index);
  }

  run(item: PaletteItem): void {
    this.palette.close();

    if (item.action === 'logout') {
      this.auth.logout();
      void this.router.navigate(['/login']);
      return;
    }

    if (item.path) {
      void this.router.navigateByUrl(item.path);
    }
  }

  private move(delta: number, length: number): void {
    if (!length) return;

    const next = (this.selected() + delta + length) % length;
    this.selected.set(next);
    requestAnimationFrame(() => {
      document
        .getElementById(`palette-item-${next}`)
        ?.scrollIntoView({ block: 'nearest' });
    });
  }
}
