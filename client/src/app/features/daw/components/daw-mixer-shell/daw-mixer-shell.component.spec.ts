import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DawMixerShellComponent } from './daw-mixer-shell.component';

@Component({
  standalone: true,
  imports: [DawMixerShellComponent],
  template: '<app-daw-mixer-shell><span>Mezclador</span></app-daw-mixer-shell>'
})
class MixerShellHostComponent {}

describe('DawMixerShellComponent', () => {
  it('renders projected mixer controls inside its encapsulated shell', () => {
    TestBed.configureTestingModule({ imports: [MixerShellHostComponent] });
    const fixture = TestBed.createComponent(MixerShellHostComponent);
    fixture.detectChanges();

    const shell = fixture.nativeElement.querySelector('app-daw-mixer-shell');
    expect(shell.querySelector('.mixer-shell')?.textContent).toContain('Mezclador');
  });
});
