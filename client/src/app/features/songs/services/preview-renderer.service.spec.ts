import { describe, expect, it } from 'vitest';
import { SongParserService } from '../../../core/song-parser/song-parser.service';
import { SongPreviewData } from '../models/song-preview.model';
import { PreviewRendererService } from './preview-renderer.service';

const DATA: SongPreviewData = {
  title: 'Canción de prueba',
  artist: 'Artista',
  key: 'C',
  mode: '',
  tempo: 120,
  time: '4/4',
  structure: 'Verso\nInstrumental',
  songText: [
    '[VERSO]',
    'C       G',
    'Hola mundo',
    '',
    '[INSTRUMENTAL]',
    'Am'
  ].join('\n')
};

function render(view?: 'all' | 'lyrics' | 'chords'): HTMLElement {
  const renderer = new PreviewRendererService(new SongParserService());
  const element = document.createElement('div');
  renderer.renderPreview(DATA, element, view);
  return element;
}

function renderSong(data: SongPreviewData, view?: 'all' | 'lyrics' | 'chords'): HTMLElement {
  const renderer = new PreviewRendererService(new SongParserService());
  const element = document.createElement('div');
  renderer.renderPreview(data, element, view);
  return element;
}

describe('PreviewRendererService view modes', () => {
  it('renders chords and lyrics together by default', () => {
    const element = render();

    expect(element.querySelectorAll('.mono-chord')).toHaveLength(1);
    expect(element.querySelectorAll('.mono-chords-only')).toHaveLength(1);
    expect(element.querySelectorAll('.mono-lyric')).toHaveLength(1);
    expect(element.textContent).toContain('Hola mundo');
  });

  it('shows only lyrics and omits chord-only sections in lyrics mode', () => {
    const element = render('lyrics');

    expect(element.querySelectorAll('.mono-chord')).toHaveLength(0);
    expect(element.querySelectorAll('.mono-chords-only')).toHaveLength(0);
    expect(element.querySelectorAll('.mono-lyric')).toHaveLength(1);
    expect(element.textContent).toContain('Hola mundo');
    expect(element.textContent).not.toContain('INSTRUMENTAL');
    expect(element.textContent).not.toContain('Am');
  });

  it('shows only chords and omits lyric-only sections in chords mode', () => {
    const element = render('chords');

    expect(element.querySelectorAll('.mono-chord')).toHaveLength(1);
    expect(element.querySelectorAll('.mono-chords-only')).toHaveLength(1);
    expect(element.querySelectorAll('.mono-lyric')).toHaveLength(0);
    expect(element.textContent).toContain('C    G');
    expect(element.textContent).toContain('Am');
    expect(element.textContent).not.toContain('Hola mundo');
  });
});

describe('PreviewRendererService HTML escaping', () => {
  it('renders HTML-like song content as text instead of executing it', () => {
    const element = renderSong({
      ...DATA,
      title: '<img src=x onerror="alert(1)">',
      artist: '<b>Artista</b>',
      songText: [
        '[VERSO]',
        'C       G',
        '<script>alert("xss")</script>',
        'Letra con <strong>etiquetas</strong> y &amp;'
      ].join('\n')
    });

    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('script')).toBeNull();
    expect(element.querySelector('.mono-lyric strong')).toBeNull();
    expect(element.querySelector('.chart-title')?.textContent).toContain('<img src=x');
    expect(element.textContent).toContain('<script>alert("xss")</script>');
    expect(element.textContent).toContain('<strong>etiquetas</strong>');
    expect(element.textContent).toContain('&amp;');
  });
});
