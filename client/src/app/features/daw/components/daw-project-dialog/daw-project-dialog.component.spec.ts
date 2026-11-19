import { TestBed } from '@angular/core/testing';
import { ProjectResponse } from '../../models/daw.models';
import { DawProjectDialogComponent } from './daw-project-dialog.component';

const PROJECT: ProjectResponse = {
  id: 9,
  version: 1,
  name: 'Maqueta',
  tempo: 96,
  time_signature: '4/4',
  transpose: 0,
  created_at: '2026-01-01T00:00:00',
  updated_at: null,
  tracks: [],
};

describe('DawProjectDialogComponent', () => {
  it('shows an empty state when there are no saved projects', () => {
    const fixture = TestBed.createComponent(DawProjectDialogComponent);
    fixture.componentInstance.loading = false;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.project-empty')?.textContent).toContain(
      'no hay proyectos',
    );
  });

  it('renders saved projects and marks the open one', () => {
    const fixture = TestBed.createComponent(DawProjectDialogComponent);
    fixture.componentInstance.projects = [PROJECT];
    fixture.componentInstance.currentProjectId = PROJECT.id;
    fixture.detectChanges();

    const item = fixture.nativeElement.querySelector('.project-item') as HTMLElement;
    expect(item.textContent).toContain('Maqueta');
    expect(item.classList.contains('current')).toBe(true);
    expect(item.textContent).toContain('Abierto');
  });

  it('emits the project when its row is clicked', () => {
    const fixture = TestBed.createComponent(DawProjectDialogComponent);
    fixture.componentInstance.projects = [PROJECT];
    fixture.detectChanges();
    let selected: ProjectResponse | undefined;
    fixture.componentInstance.opened.subscribe((project) => (selected = project));

    (fixture.nativeElement.querySelector('.project-main') as HTMLButtonElement).click();

    expect(selected).toEqual(PROJECT);
  });

  it('counts tracks defensively when the response omits them', () => {
    const component = new DawProjectDialogComponent();
    expect(component.trackCount({ ...PROJECT, tracks: undefined as unknown as [] })).toBe(0);
  });
});
