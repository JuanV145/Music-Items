import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AudioTrack } from '../../models/daw.models';

export interface TrackPanelItem {
  track: AudioTrack;
  index: number;
  color: string;
  pitchDraft: number;
  busy: boolean;
  pitchLabel: string;
}

@Component({
  selector: 'app-daw-track-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './daw-track-panel.component.html',
  styleUrl: './daw-track-panel.component.scss'
})
export class DawTrackPanelComponent {
  @Input() items: TrackPanelItem[] = [];
  @Input() rulerHeight = 58;
  @Input() trackHeight = 66;
  @Input() minSemitones = -12;
  @Input() maxSemitones = 12;

  @ViewChild('trackList') private trackList?: ElementRef<HTMLDivElement>;

  @Output() readonly listScrolled = new EventEmitter<number>();
  @Output() readonly importRequested = new EventEmitter<void>();
  @Output() readonly colorChanged = new EventEmitter<{ trackId: string; color: string }>();
  @Output() readonly nameChanged = new EventEmitter<{ trackId: string; name: string }>();
  @Output() readonly muteToggle = new EventEmitter<string>();
  @Output() readonly soloToggle = new EventEmitter<string>();
  @Output() readonly removeTrack = new EventEmitter<string>();
  @Output() readonly pitchDraftChanged = new EventEmitter<{ trackId: string; value: number }>();
  @Output() readonly pitchApplied = new EventEmitter<string>();

  /** Úsalo en la plantilla: *ngFor="let item of items; trackBy: trackByItem" */
  readonly trackByItem = (_: number, item: TrackPanelItem): string => item.track.id;

  onListScroll(event: Event): void {
    this.listScrolled.emit((event.target as HTMLDivElement).scrollTop);
  }

  setScrollTop(scrollTop: number): void {
    if (this.trackList) this.trackList.nativeElement.scrollTop = scrollTop;
  }
}
