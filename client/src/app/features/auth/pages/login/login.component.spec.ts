import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  let login: ReturnType<typeof vi.fn>;
  let navigateByUrl: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    login = vi.fn().mockReturnValue(of(undefined));
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { login } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: () => '/modificar' } } },
        },
      ],
    }).compileComponents();
    navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  it('logs in and returns to the originally requested route', () => {
    const fixture = TestBed.createComponent(LoginComponent);
    const component = fixture.componentInstance;
    component.username = 'ADMIN';
    component.password = 'nevu';

    component.submit();

    expect(login).toHaveBeenCalledWith('ADMIN', 'nevu');
    expect(navigateByUrl).toHaveBeenCalledWith('/modificar');
  });

  it('shows a clear message when credentials are rejected', () => {
    login.mockReturnValue(throwError(() => ({ status: 401 })));
    const component = TestBed.createComponent(LoginComponent).componentInstance;
    component.username = 'ADMIN';
    component.password = 'wrong';

    component.submit();

    expect(component.errorMessage).toContain('incorrectos');
  });
});
