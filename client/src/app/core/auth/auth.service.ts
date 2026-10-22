import { HttpClient, HttpParams } from '@angular/common/http';
import { computed, Injectable, signal } from '@angular/core';
import { map, Observable, tap } from 'rxjs';

interface TokenResponse {
  access_token: string;
  token_type: string;
}

const TOKEN_KEY = 'access_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly token = signal(this.readStoredToken());
  readonly isAuthenticated = computed(() => this.token() !== null);

  constructor(private readonly http: HttpClient) {}

  get accessToken(): string | null {
    return this.token();
  }

  login(username: string, password: string): Observable<void> {
    const body = new HttpParams()
      .set('username', username)
      .set('password', password);

    return this.http.post<TokenResponse>('/api/auth/token', body).pipe(
      tap(response => {
        this.storeToken(response.access_token);
      }),
      map(() => undefined),
    );
  }

  logout(): void {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // Storage may be unavailable in restricted browser contexts.
    }
    this.token.set(null);
  }

  private readStoredToken(): string | null {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  private storeToken(token: string): void {
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Keep the token in memory for this application session.
    }
    this.token.set(token);
  }
}
