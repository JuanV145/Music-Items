import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SongParserService } from '../../../core/song-parser/song-parser.service';
import { SongPreviewData } from '../models/song-preview.model';
import { ExportService } from './export.service';
import { StatusService } from './status.service';

const { FakePdf } = vi.hoisted(() => {
  class FakePdf {
    static instances: FakePdf[] = [];

    readonly texts: string[] = [];
    readonly internal = {
      pageSize: { getWidth: () => 210, getHeight: () => 297 },
      getNumberOfPages: () => 1
    };

    constructor() {
      FakePdf.instances.push(this);
    }

    setFont(): void {}
    setFontSize(): void {}
    setTextColor(): void {}
    setFillColor(): void {}
    setDrawColor(): void {}
    setLineWidth(): void {}
    circle(): void {}
    line(): void {}
    roundedRect(): void {}
    addPage(): void {}
    setPage(): void {}
    save(): void {}

    getNumberOfPages(): number {
      return 1;
    }

    text(value: string): void {
      this.texts.push(String(value));
    }

    getTextWidth(value: string): number {
      return String(value).length * 2;
    }
  }

  return { FakePdf };
});

vi.mock('jspdf', () => ({ jsPDF: FakePdf }));

const DATA: SongPreviewData = {
  title: 'Mi Canción',
  artist: 'Mi Artista',
  key: 'C',
  mode: '',
  tempo: 120,
  time: '4/4',
  structure: 'Verso\nInstrumental',
  songText: [
    '[VERSO]',
    'F#m     Bm',
    'Hola mundo',
    '',
    '[INSTRUMENTAL]',
    'Am'
  ].join('\n')
};


function lastPdfText(): string {
  return FakePdf.instances[FakePdf.instances.length - 1].texts.join('\n');
}

async function exportPdf(view: 'all' | 'lyrics' | 'chords', data: SongPreviewData = DATA): Promise<string> {
  const service = new ExportService(document, new SongParserService(), new StatusService());
  await service.exportPDF(data, view);
  return lastPdfText();
}

describe('ExportService PDF view modes', () => {
  beforeEach(() => {
    FakePdf.instances = [];
  });

  it('includes the title and header info from the provided song data', async () => {
    const text = await exportPdf('all');

    expect(text).toContain('Mi Canción');
    expect(text).toContain('MI ARTISTA');
    expect(text).toContain('Tono: C    Tempo: 120    Compás: 4/4');
  });

  it('exports only lyrics when the lyrics view is active', async () => {
    const text = await exportPdf('lyrics');

    expect(text).toContain('Hola mundo');
    expect(text).not.toContain('F#m');
    expect(text).not.toContain('Am');
  });

  it('exports only chords, evenly spaced, when the chords view is active', async () => {
    const text = await exportPdf('chords');

    expect(text).toContain('F#m    Bm');
    expect(text).toContain('Am');
    expect(text).not.toContain('Hola mundo');
  });

  it('keeps original chord spacing when both lyrics and chords are exported', async () => {
    const text = await exportPdf('all');

    expect(text).toContain('F#m     Bm');
    expect(text).toContain('Hola mundo');
  });

  it('cleans zero-width spaces and combining accents pasted from the web', async () => {
    const text = await exportPdf('all', {
      ...DATA,
      title: '\u200bMi Canción',
      artist: 'Artista\u00ad',
      songText: [
        '[VERSO]',
        'C       G',
        '\u200bQuie\u0301n soy yo\u200b'
      ].join('\n')
    });

    // NFC compone "e" + acento combinado y se eliminan los caracteres invisibles,
    // evitando que jsPDF codifique la cadena como UTF-16 y deforme la letra.
    expect(text).toContain('Quién soy yo');
    expect(text).not.toContain('\u200b');
    expect(text).not.toContain('\u0301');
    expect(text).not.toContain('\u00ad');
  });
});
