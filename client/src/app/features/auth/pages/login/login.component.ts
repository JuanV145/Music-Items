import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  username = 'ADMIN';
  password = '';
  errorMessage = '';
  isSubmitting = false;

  constructor(
    private readonly auth: AuthService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  submit(): void {
    if (this.isSubmitting || !this.username.trim() || !this.password) return;

    this.errorMessage = '';
    this.isSubmitting = true;
    this.auth.login(this.username.trim(), this.password).subscribe({
      next: () => {
        this.isSubmitting = false;
        void this.router.navigateByUrl(this.getReturnUrl());
      },
      error: () => {
        this.isSubmitting = false;
        this.errorMessage = 'El usuario o la contraseña son incorrectos. Inténtalo de nuevo.';
      },
    });
  }

  private getReturnUrl(): string {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    return returnUrl?.startsWith('/') && !returnUrl.startsWith('//') ? returnUrl : '/';
  }
}
