import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ProjectResponse, TrackResponse } from '../models/daw.models';

/** Metadatos de proyecto tal y como los espera el backend. */
export interface ProjectMeta {
  name: string;
  tempo: number;
  time_signature: string;
  transpose: number;
}

/** Actualización de proyecto con bloqueo optimista opcional. */
export interface ProjectUpdate extends Partial<ProjectMeta> {
  expected_version?: number;
}

/** Metadatos de pista que viajan en el JSON de actualización. */
export interface TrackMeta {
  name: string;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  clip_offset: number;
  clip_duration: number;
  color: string | null;
  source_offset: number;
  pitch_semitones: number;
}

@Injectable({ providedIn: 'root' })
export class DawProjectService {
  private readonly apiUrl = '/api/daw';

  constructor(private readonly http: HttpClient) {}

  // ───────────────────────────── Proyectos ─────────────────────────────

  async listProjects(): Promise<ProjectResponse[]> {
    const projects = await firstValueFrom(
      this.http.get<ProjectResponse[]>(`${this.apiUrl}/projects/`),
    );
    return projects ?? [];
  }

  getProject(projectId: number): Promise<ProjectResponse> {
    return firstValueFrom(this.http.get<ProjectResponse>(`${this.apiUrl}/projects/${projectId}`));
  }

  createProject(meta: ProjectMeta): Promise<ProjectResponse> {
    return firstValueFrom(this.http.post<ProjectResponse>(`${this.apiUrl}/projects/`, meta));
  }

  updateProject(projectId: number, meta: ProjectUpdate): Promise<ProjectResponse> {
    return firstValueFrom(
      this.http.put<ProjectResponse>(`${this.apiUrl}/projects/${projectId}`, meta),
    );
  }

  async deleteProject(projectId: number): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.apiUrl}/projects/${projectId}`));
  }

  // ───────────────────────────── Pistas ─────────────────────────────

  /** Crea una pista subiendo el audio original en `multipart/form-data`. */
  createTrack(
    projectId: number,
    meta: TrackMeta,
    audio: Blob,
    filename: string,
  ): Promise<TrackResponse> {
    return firstValueFrom(
      this.http.post<TrackResponse>(
        `${this.apiUrl}/projects/${projectId}/tracks/`,
        this.trackFormData(meta, audio, filename),
      ),
    );
  }

  updateTrack(trackId: number, meta: Partial<TrackMeta>): Promise<TrackResponse> {
    return firstValueFrom(this.http.put<TrackResponse>(`${this.apiUrl}/tracks/${trackId}`, meta));
  }

  async deleteTrack(trackId: number): Promise<void> {
    await firstValueFrom(this.http.delete(`${this.apiUrl}/tracks/${trackId}`));
  }

  /** Descarga el audio original de una pista guardada. */
  fetchTrackAudio(trackId: number): Promise<Blob> {
    return firstValueFrom(
      this.http.get(`${this.apiUrl}/tracks/${trackId}/audio`, { responseType: 'blob' }),
    );
  }

  /**
   * Elimina en el servidor las pistas que ya no están en la sesión.
   * Se difiere hasta el guardado para que descartar cambios no borre audio.
   */
  async pruneTracks(trackIds: number[]): Promise<void> {
    for (const trackId of trackIds) await this.deleteTrack(trackId);
  }

  /** Nombre de archivo seguro y aceptado por el backend (wav/mp3). */
  filenameFor(name: string, extension: 'wav' | 'mp3'): string {
    const base =
      name
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\-. ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[.\s]+/, '')
        .replace(/ /g, '_')
        .slice(0, 80) || 'pista';
    return `${base}.${extension}`;
  }

  private trackFormData(meta: TrackMeta, audio: Blob, filename: string): FormData {
    const form = new FormData();
    form.append('name', meta.name);
    form.append('volume', String(meta.volume));
    form.append('pan', String(meta.pan));
    form.append('muted', String(meta.muted));
    form.append('solo', String(meta.solo));
    form.append('clip_offset', String(meta.clip_offset));
    form.append('clip_duration', String(meta.clip_duration));
    form.append('source_offset', String(meta.source_offset));
    form.append('pitch_semitones', String(meta.pitch_semitones));
    if (meta.color) form.append('color', meta.color);
    form.append('audio_file', audio, filename);
    return form;
  }
}
