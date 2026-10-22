import { TestBed } from '@angular/core/testing';
import { AudioTrack } from '../../models/daw.models';
import { DawTrackPanelComponent, TrackPanelItem } from './daw-track-panel.component';

describe('DawTrackPanelComponent', () => {
  it('emits the selected track id when mute is toggled', () => {
    TestBed.configureTestingModule({ imports: [DawTrackPanelComponent] });
    const fixture = TestBed.createComponent(DawTrackPanelComponent);
    const track = { id: 'track-1', name: 'Guitar', muted: false, solo: false } as AudioTrack;
    fixture.componentInstance.items = [{
      track,
      index: 0,
      color: '#123456',
      pitchDraft: 0,
      busy: false,
      pitchLabel: 'APLICAR'
    } satisfies TrackPanelItem];
    fixture.detectChanges();

    let mutedTrackId = '';
    fixture.componentInstance.muteToggle.subscribe(id => mutedTrackId = id);
    fixture.nativeElement.querySelector('.mute-btn').click();

    expect(mutedTrackId).toBe('track-1');
  });
});
