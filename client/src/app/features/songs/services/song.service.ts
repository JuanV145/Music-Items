import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Song } from '../models/song.model';

@Injectable({
  providedIn: 'root'
})
export class SongService {
  private readonly apiUrl = '/api/songs/';

  constructor(private http: HttpClient) { }

  async saveSong(songData: Song): Promise<Song> {
    try {
      const response = await firstValueFrom(
        this.http.post<Song>(this.apiUrl, songData)
      );

      return response;
    } catch (error) {
      console.error('Error saving song:', error);
      throw error;
    }
  }

  async loadSong(songId: number): Promise<Song> {
    try {
      const response = await firstValueFrom(
        this.http.get<Song>(`${this.apiUrl}${songId}`)
      );

      return response;
    } catch (error) {
      console.error('Error loading song:', error);
      throw error;
    }
  }

  async updateSong(songId: number, songData: Song): Promise<Song> {
    try {
      const payload = {
        title: songData.title,
        artist: songData.artist ?? null,
        key_root: songData.key_root,
        key_mode: songData.key_mode,
        tempo: songData.tempo,
        time_signature: songData.time_signature,
        structure: songData.structure ?? null,
        chords_lyrics: songData.chords_lyrics
      };
      const response = await firstValueFrom(
        this.http.put<Song>(`${this.apiUrl}${songId}`, payload)
      );

      return response;
    } catch (error) {
      console.error('Error updating song:', error);
      throw error;
    }
  }

  async getSongs(): Promise<Song[]> {
    try {
      const response = await firstValueFrom(
        this.http.get<Song[]>(this.apiUrl)
      );

      return response ?? [];
    } catch (error) {
      console.error('Error fetching songs list:', error);
      throw error;
    }
  }

  async deleteSong(songId: number): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.delete(`${this.apiUrl}${songId}`)
      );

      return true;
    } catch (error) {
      console.error('Error deleting song:', error);
      throw error;
    }
  }
}