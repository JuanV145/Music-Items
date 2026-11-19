import { AfterViewInit, Component, ElementRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss', './home-hero-art.scss', './home-tool-art.scss'],
})
export class HomeComponent implements AfterViewInit, OnDestroy {
  /** Dos copias del mismo contenido: el marquee avanza exactamente -50%. */
  readonly tickerGroups = [0, 1];

  private revealObserver?: IntersectionObserver;
  private removeSpotlight?: () => void;

  constructor(private readonly elementRef: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    this.setupReveal();
    this.setupSpotlight();
  }

  ngOnDestroy(): void {
    this.revealObserver?.disconnect();
    this.removeSpotlight?.();
  }

  private setupReveal(): void {
    const host = this.elementRef.nativeElement;
    const items = host.querySelectorAll<HTMLElement>(
      '.hero-copy, .hero-console, .ticker, .section-head, .tool, .home-foot',
    );

    if (typeof IntersectionObserver === 'undefined') {
      items.forEach((item) => item.classList.add('is-visible'));
      return;
    }

    this.revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          entry.target.classList.add('is-visible');
          this.revealObserver?.unobserve(entry.target);
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -6% 0px' },
    );

    items.forEach((item, index) => {
      item.style.setProperty('--reveal-delay', `${(index % 4) * 70}ms`);
      this.revealObserver?.observe(item);
    });
  }

  /**
   * La luz sigue al puntero dentro de cada tarjeta. Se escribe la variable en
   * la tarjeta (no en el contenedor) para no recalcular estilos de sus hermanas.
   */
  private setupSpotlight(): void {
    if (typeof window === 'undefined') return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (reduced || !finePointer) return;

    const host = this.elementRef.nativeElement;

    const onPointerMove = (event: PointerEvent): void => {
      const target = event.target as HTMLElement | null;
      const card = target?.closest<HTMLElement>('.tool');
      if (!card) return;

      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
      card.style.setProperty('--my', `${event.clientY - rect.top}px`);
    };

    host.addEventListener('pointermove', onPointerMove, { passive: true });
    this.removeSpotlight = () => host.removeEventListener('pointermove', onPointerMove);
  }
}
