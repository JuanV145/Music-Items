import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { ProjectResponse } from '../../models/daw.models';

/** Diálogo presentacional para listar, abrir y eliminar proyectos del DAW. */
@Component({
  selector: 'app-daw-project-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './daw-project-dialog.component.html',
  styleUrls: ['./daw-project-dialog.component.scss'],
})
export class DawProjectDialogComponent {
  @Input() projects: ProjectResponse[] = [];
  @Input() currentProjectId?: number;
  @Input() loading = false;
  @Input() busy = false;
  @Input() error = '';

  @Output() opened = new EventEmitter<ProjectResponse>();
  @Output() removed = new EventEmitter<ProjectResponse>();
  @Output() created = new EventEmitter<void>();
  @Output() closed = new EventEmitter<void>();

  trackCount(project: ProjectResponse): number {
    return project.tracks?.length ?? 0;
  }

  onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }
}
