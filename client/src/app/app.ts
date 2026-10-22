import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MenuComponent } from './layout/menu/menu.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterModule, MenuComponent],
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('client');
  currentYear: number = new Date().getFullYear();

  constructor(private readonly router: Router) {}

  get isLoginRoute(): boolean {
    return this.router.url.split(/[?#]/, 1)[0] === '/login';
  }
}