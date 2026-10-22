import { Component, ViewEncapsulation } from '@angular/core';

@Component({
  selector: 'app-daw-mixer-shell',
  standalone: true,
  template: '<div class="mixer-shell"><ng-content></ng-content></div>',
  styleUrls: ['./daw-mixer-shell.component.scss', './daw-mixer-channel-controls.scss'],
  encapsulation: ViewEncapsulation.None
})
export class DawMixerShellComponent {}
