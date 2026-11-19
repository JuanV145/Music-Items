import { Injectable } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Inject } from '@angular/core';
import { SongParserService } from '../../../core/song-parser/song-parser.service';
import { SongPreviewData, SongTextViewMode } from '../models/song-preview.model';
import { StatusService } from './status.service';

@Injectable({
  providedIn: 'root'
})
export class ExportService {
  private doc: Document;

  constructor(
    @Inject(DOCUMENT) private document: Document,
    private songParser: SongParserService,
    private statusService: StatusService
  ) {
    this.doc = document;
  }

  exportTXT(): void {
    const titleEl = this.doc.getElementById('songTitle');
    const artistEl = this.doc.getElementById('songArtist');
    const keyEl = this.doc.getElementById('currentKey');
    const modeEl = this.doc.getElementById('currentMode');
    const tempoEl = this.doc.getElementById('songTempo');
    const timeEl = this.doc.getElementById('songTime');
    const structEl = this.doc.getElementById('structEditor');
    const editorEl = this.doc.getElementById('editor');

    const title = titleEl ? (titleEl as HTMLInputElement).value.trim() : 'Cifrado';
    const artist = artistEl ? (artistEl as HTMLInputElement).value.trim() : '';
    const key = keyEl ? (keyEl as HTMLSelectElement).value : '';
    const mode = modeEl ? (modeEl as HTMLSelectElement).value : '';
    const tempo = tempoEl ? (tempoEl as HTMLInputElement).value : '72';
    const time = timeEl ? (timeEl as HTMLInputElement).value : '4/4';
    const structText = structEl ? (structEl as HTMLTextAreaElement).value : '';
    const songText = editorEl ? (editorEl as HTMLTextAreaElement).value : '';

    const keyDisplay = key + mode;

    let out = `${title}\n`;
    if (artist) out += `${artist}\n`;
    out += `Clave: ${keyDisplay}   Tempo: ${tempo}   Compás: ${time}\n`;

    if (structText.trim()) {
      out += `\n=== ESTRUCTURA ===\n${structText}\n`;
    }

    out += `\n=== CIFRADO ===\n${songText}\n`;

    const blob = new Blob([out], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = this.doc.createElement('a');
    const safeName = (title || 'cifrado').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_') || 'cifrado';
    a.href = url;
    a.download = `${safeName}.txt`;
    this.doc.body.appendChild(a);
    a.click();
    this.doc.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showStatus('TXT exportado ✓');
  }

  private getColorOf(label: string): number {
    return this.songParser.colorOf(label);
  }

  async exportPDF(data?: SongPreviewData | null, view: SongTextViewMode = 'all'): Promise<void> {
    this.showStatus('Generando PDF...');

    let jsPDF: typeof import('jspdf').jsPDF;
    try {
      // Carga diferida: jsPDF solo se descarga cuando el usuario exporta un PDF.
      ({ jsPDF } = await import('jspdf'));
    } catch (error) {
      console.error('No se pudo cargar jsPDF:', error);
      this.showStatus('Error: no se pudo cargar el generador de PDF.', 3000);
      return;
    }

    const song = data ?? this.readSongDataFromDom();

    // jsPDF con fuentes estándar (helvetica/courier) solo codifica Latin-1. Si el
    // texto trae caracteres invisibles (espacio de ancho cero) o diacríticos
    // combinados —habitual al pegar letras desde la web—, jsPDF pasa toda la
    // cadena a UTF-16 y el PDF se ve con las letras deformadas/gigantes.
    const title = this.sanitizePdfText(song.title || 'Sin título').trim();
    const artist = this.sanitizePdfText(song.artist || '').trim() || null;
    const keyDisplay = this.sanitizePdfText(`${song.key || ''}${song.mode || ''}`);
    const tempo = this.sanitizePdfText(String(song.tempo ?? '—'));
    const timeSig = this.sanitizePdfText(song.time || '—');
    const structText = this.sanitizePdfText(song.structure || '').trim();
    const songText = this.sanitizePdfText(song.songText || '').trim();

    const sections = this.applyViewToSections(
      this.songParser.parseSong(songText).filter(s => s.label || s.blocks.length),
      view
    );
    const structure = structText ? this.songParser.parseStructure(structText) : [];

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'p' });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 12;
    const columnGap = 6;
    const usableWidth = pageWidth - 2 * margin;
    const colWidth = (usableWidth - columnGap) / 2;
    const colX = [margin, margin + colWidth + columnGap];
    const footerSpace = 8;
    const bottomLimit = pageHeight - margin - footerSpace;
    const boxGap = 4;
    const pad = 3;

    const PDF_SEC_COLORS = ['#5046e5', '#059669', '#db2777', '#d97706', '#2563eb', '#7c3aed', '#b45309'];

    let maxChars = 10;
    for (const sec of sections) {
      for (const blk of sec.blocks) {
        if (blk.type === 'pair') maxChars = Math.max(maxChars, blk.chords.length, blk.lyrics.length);
        else if (blk.type === 'chords-only') maxChars = Math.max(maxChars, blk.chords.length);
        else if (blk.type === 'lyrics') maxChars = Math.max(maxChars, blk.text.length);
      }
    }
    const innerWidth = colWidth - 2 * pad;
    let bodyFS = innerWidth / (maxChars * 0.6 * 0.3528);
    bodyFS = Math.max(8, Math.min(9, bodyFS));
    const lineH = bodyFS * 0.3528 * 1.5;

    function drawMasthead() {
      let hy = margin + 6;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(20);
      pdf.setTextColor(20, 20, 20);
      pdf.text(title, margin, hy);

      if (artist) {
        hy += 6;
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9.5);
        pdf.setTextColor(140, 140, 150);
        pdf.text(artist.toUpperCase(), margin, hy);
      }

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(90, 90, 100);
      const metaLine = `Tono: ${keyDisplay}    Tempo: ${tempo}    Compás: ${timeSig}`;
      pdf.text(metaLine, pageWidth - margin, margin + 6, { align: 'right' });

      let dividerY = margin + 12;

      if (structure.length) {
        dividerY += 2;
        const d = 5.6, badgeGap = 1.6, pillGap = 3.4, rowGap = 2.6;
        let sx = margin, sy = dividerY;

        for (const item of structure) {
          const repsText = item.reps ? ` x${item.reps}` : '';

          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(7);
          const labelW = pdf.getTextWidth(item.label);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(6);
          const repsW = repsText ? pdf.getTextWidth(repsText) : 0;

          const pillW = d + badgeGap + labelW + repsW;

          if (sx + pillW > pageWidth - margin) {
            sx = margin;
            sy += d + rowGap;
          }

          const rgb = pdfHexToRgb(PDF_SEC_COLORS[item.ci]);
          pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
          pdf.setDrawColor(rgb[0], rgb[1], rgb[2]);
          pdf.circle(sx + d / 2, sy + d / 2, d / 2, 'F');
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(5.4);
          pdf.setTextColor(255, 255, 255);
          pdf.text(item.abbrev, sx + d / 2, sy + d / 2 + 1.3, { align: 'center' });

          const textBaseY = sy + d / 2 + 1.3;
          let tx = sx + d + badgeGap;
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(7);
          pdf.setTextColor(50, 50, 58);
          pdf.text(item.label, tx, textBaseY);
          tx += labelW;

          if (repsText) {
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(6);
            pdf.setTextColor(150, 150, 160);
            pdf.text(repsText, tx, textBaseY);
          }

          sx += pillW + pillGap;
        }
        dividerY = sy + d + 3;
      }

      pdf.setDrawColor(210, 210, 215);
      pdf.setLineWidth(0.25);
      pdf.line(margin, dividerY, pageWidth - margin, dividerY);
      pdf.setTextColor(0, 0, 0);

      return dividerY + 5;
    }

    function drawContinuationHeader() {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.setTextColor(120, 120, 130);
      pdf.text(`${title} (continuación)`, margin, margin + 4);
      pdf.setTextColor(0, 0, 0);
      pdf.setDrawColor(210, 210, 215);
      pdf.setLineWidth(0.25);
      pdf.line(margin, margin + 7, pageWidth - margin, margin + 7);
      return margin + 12;
    }

    function boxHeight(sec: any) {
      let h = pad * 2;
      if (sec.label) h += 6.5; // header row
      for (const blk of sec.blocks) {
        if (blk.type === 'pair') h += lineH * 2;
        else if (blk.type === 'chords-only' || blk.type === 'lyrics') h += lineH;
        else if (blk.type === 'spacer') h += lineH * 0.45;
      }
      return h;
    }

    function drawBox(sec: any, x: number, y: number) {
      const h = boxHeight(sec);
      const rgb = pdfHexToRgb(PDF_SEC_COLORS[getColorOf(sec.label || 'x')]);

      pdf.setDrawColor(220, 220, 226);
      pdf.setFillColor(250, 250, 252);
      pdf.setLineWidth(0.25);
      pdf.roundedRect(x, y, colWidth, h, 1.6, 1.6, 'FD');

      let cy = y + pad;

      if (sec.label) {
        const badgeD = 4.6;
        pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
        pdf.circle(x + pad + badgeD / 2, cy + badgeD / 2, badgeD / 2, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(6);
        pdf.setTextColor(255, 255, 255);
        pdf.text(getAbbrevOf(sec.label), x + pad + badgeD / 2, cy + badgeD / 2 + 1.3, { align: 'center' });

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9.5);
        const darkRgb = pdfDarken(rgb, 0.75);
        pdf.setTextColor(darkRgb[0], darkRgb[1], darkRgb[2]);
        const labelX = x + pad + badgeD + 2;
        pdf.text(sec.label.toUpperCase(), labelX, cy + badgeD / 2 + 1.3);

        if (sec.note) {
          pdf.setFont('helvetica', 'italic');
          pdf.setFontSize(6.8);
          pdf.setTextColor(150, 150, 160);
          let note = sec.note;
          const maxNoteW = colWidth - pad * 2 - 20;
          while (pdf.getTextWidth(note) > maxNoteW && note.length > 3) note = note.slice(0, -2);
          if (note !== sec.note) note = note.trim() + '…';
          pdf.text(note, x + colWidth - pad, cy + badgeD / 2 + 1.3, { align: 'right' });
        }
        cy += 6.5;
      }

      pdf.setFont('courier', 'normal');
      for (const blk of sec.blocks) {
        if (blk.type === 'spacer') {
          cy += lineH * 0.45;
          continue;
        }
        if (blk.type === 'pair') {
          pdf.setFont('courier', 'bold');
          pdf.setFontSize(bodyFS);
          pdf.setTextColor(30, 30, 30);
          pdf.text(blk.chords, x + pad, cy + lineH * 0.75);
          cy += lineH;
          pdf.setFont('courier', 'normal');
          pdf.setFontSize(bodyFS);
          pdf.setTextColor(55, 55, 60);
          pdf.text(blk.lyrics, x + pad, cy + lineH * 0.75);
          cy += lineH;
        } else if (blk.type === 'chords-only') {
          pdf.setFont('courier', 'bold');
          pdf.setFontSize(bodyFS);
          pdf.setTextColor(30, 30, 30);
          pdf.text(blk.chords, x + pad, cy + lineH * 0.75);
          cy += lineH;
        } else if (blk.type === 'lyrics') {
          pdf.setFont('courier', 'normal');
          pdf.setFontSize(bodyFS);
          pdf.setTextColor(55, 55, 60);
          pdf.text(blk.text, x + pad, cy + lineH * 0.75);
          cy += lineH;
        }
      }

      pdf.setTextColor(0, 0, 0);
      return h;
    }

    function pdfHexToRgb(hex: string) {
      const c = hex.replace('#', '');
      const n = parseInt(c, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function pdfDarken(rgb: number[], amt = 0.65) {
      return rgb.map(v => Math.round(v * amt));
    }

    function getColorOf(label: string): number {
      const key = label.toLowerCase().replace(/\s*\d+\s*$/, '').trim();
      const SEC_COLOR: Record<string, number> = {
        intro: 0, verse: 1, verso: 1, 'pre-chorus': 2, 'pre-coro': 2,
        chorus: 3, coro: 3, 'post-chorus': 4, 'post-coro': 4,
        bridge: 5, puente: 5, outro: 6, interlude: 4, interludio: 4,
      };
      for (const [k, v] of Object.entries(SEC_COLOR))
        if (key === k || key.startsWith(k)) return v;
      return 0;
    }

    function getAbbrevOf(label: string) {
      const key = label.toLowerCase().replace(/\s*\d+\s*$/, '').trim();
      const num = (label.match(/\d+$/) || [''])[0];
      const SEC_ABBREV: any = {
        intro: 'I', verse: 'V', verso: 'V', 'pre-chorus': 'PC', 'pre-coro': 'PC',
        chorus: 'C', coro: 'C', 'post-chorus': 'PC', 'post-coro': 'PC',
        bridge: 'B', puente: 'P', outro: 'O', interlude: 'IL', interludio: 'IL',
      };
      for (const [k, v] of Object.entries(SEC_ABBREV))
        if (key === k || key.startsWith(k)) return v + num;
      return label.slice(0, 2).toUpperCase() + num;
    }

    let colIndex = 0;
    let colY = [0, 0];
    let onFirstPage = true;

    function startPage(first: boolean) {
      const top = first ? drawMasthead() : drawContinuationHeader();
      colY = [top, top];
      colIndex = 0;
    }

    startPage(true);
    onFirstPage = false;

    for (const sec of sections) {
      const h = boxHeight(sec);

      if (colY[colIndex] + h > bottomLimit) {
        if (colIndex === 0 && colY[1] + h <= bottomLimit) {
          colIndex = 1;
        } else {
          pdf.addPage();
          startPage(false);
        }
      }

      drawBox(sec, colX[colIndex], colY[colIndex]);
      colY[colIndex] += h + boxGap;
    }

    const pageCount = pdf.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      pdf.setPage(i);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(140, 140, 150);
      pdf.text(`Página ${i} de ${pageCount}`, pageWidth / 2, pageHeight - 6, { align: 'center' });
      pdf.setTextColor(0, 0, 0);
    }

    const safeTitle = title.replace(/[^\w\- ]/g, '').replace(/\s+/g, '_') || 'cifrado';
    pdf.save(`${safeTitle}_cifrado.pdf`);
    this.showStatus('✓ PDF descargado');
  }

  /**
   * Normaliza el texto para las fuentes estándar de jsPDF (Latin-1/WinAnsi).
   * Elimina espacios de ancho cero y diacríticos combinados, convierte signos
   * tipográficos a ASCII y descarta cualquier carácter fuera de Latin-1.
   */
  private sanitizePdfText(text: string): string {
    return (text || '')
      .normalize('NFC')
      .replace(/[\u200B-\u200F\u2060\uFEFF\u00AD]/g, '')
      .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
      .replace(/[\u2013\u2014\u2212]/g, '-')
      .replace(/\u2026/g, '...')
      .replace(/[\u2022\u00B7]/g, '-')
      .replace(/\u266F/g, '#')
      .replace(/\u266D/g, 'b')
      .replace(/\u00A0/g, ' ')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/[^\x00-\xFF\n]/g, '');
  }

  /** Datos de la canción leídos del formulario (fallback cuando no hay previewData). */
  private readSongDataFromDom(): SongPreviewData {
    const titleEl = this.doc.getElementById('songTitle');
    const artistEl = this.doc.getElementById('songArtist');
    const keyEl = this.doc.getElementById('currentKey');
    const modeEl = this.doc.getElementById('currentMode');
    const tempoEl = this.doc.getElementById('songTempo');
    const timeEl = this.doc.getElementById('songTime');
    const structEl = this.doc.getElementById('structEditor');
    const editorEl = this.doc.getElementById('editor');

    return {
      title: titleEl ? (titleEl as HTMLInputElement).value.trim() : '',
      artist: artistEl ? (artistEl as HTMLInputElement).value.trim() : '',
      key: keyEl ? (keyEl as HTMLInputElement).value : 'C',
      mode: modeEl ? (modeEl as HTMLInputElement).value : '',
      tempo: tempoEl ? (tempoEl as HTMLInputElement).value : '—',
      time: timeEl ? (timeEl as HTMLInputElement).value : '4/4',
      structure: structEl ? (structEl as HTMLTextAreaElement).value : '',
      songText: editorEl ? (editorEl as HTMLTextAreaElement).value : ''
    };
  }

  /**
   * Adapta las secciones al modo de vista del visualizador. En los modos filtrados
   * cada par acorde/letra se convierte en una sola línea y se descartan los bloques
   * que no aplican; las secciones que quedan vacías se omiten.
   */
  private applyViewToSections(sections: any[], view: SongTextViewMode): any[] {
    if (view === 'all') return sections;

    return sections
      .map(section => {
        const blocks: any[] = [];

        for (const block of section.blocks) {
          if (block.type === 'pair') {
            blocks.push(view === 'lyrics'
              ? { type: 'lyrics', text: block.lyrics }
              : { type: 'chords-only', chords: this.songParser.normalizeChordLine(block.chords) });
          } else if (block.type === 'chords-only' && view === 'chords') {
            blocks.push({
              type: 'chords-only',
              chords: this.songParser.normalizeChordLine(block.chords)
            });
          } else if (block.type === 'lyrics' && view === 'lyrics') {
            blocks.push(block);
          }
        }

        return { ...section, blocks };
      })
      .filter(section => section.blocks.length > 0);
  }

  private showStatus(message: string, duration = 0): void {
    this.statusService.show(message, duration);
  }
}