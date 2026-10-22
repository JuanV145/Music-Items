# Acordes y Letras — Aplicación Full-Stack para Músicos

[![Angular](https://img.shields.io/badge/Angular-22.1-DD0031?logo=angular&logoColor=white)](https://angular.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.141-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python&logoColor=white)](https://python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> **Una aplicación web completa para músicos** — gestiona canciones con acordes y letras, practica con un metrónomo profesional y produce audio en un DAW (Digital Audio Workstation) basado en navegador.

---

## ✨ Características

### 🎵 Gestión de Canciones
| Función | Descripción |
|---------|-------------|
| **Visualizador** | Visualiza canciones con vista previa sincronizada de acordes/letras, transposición en tiempo real e integración con metrónomo |
| **Modificar** | Crea, edita y persiste canciones con metadatos completos (título, artista, tonalidad, tempo, compás, estructura) |
| **Importar/Exportar** | Importa desde archivos `.txt`; exporta a TXT o PDF |
| **Integración YouTube** | Busca e inserta videos de YouTube como referencia |
| **Auto-transposición** | Transpone acordes instantáneamente a cualquier tonalidad con preferencia de alteraciones (♯/♭) |

### ⏱ Metrónomo
- **Temporización precisa** mediante Web Audio API
- **Tempo configurable** (20–300 BPM)
- **Compases** desde 1/4 hasta 12/4
- **Subdivisiones**: negra, corchea, tresillo, semicorchea
- **Tiempos acentuados** con feedback visual
- **Control de volumen** y atajos de teclado

### 🎛 Digital Audio Workstation (DAW)
| Capacidad | Detalles |
|------------|---------|
| **Línea de tiempo multi-pista** | Pistas de audio ilimitadas con renderizado de forma de onda |
| **Edición de clips** | Arrastrar para mover, bordes para recortar, doble clic para resetear |
| **Controles por pista** | Volumen (fader dB), Pan (L/R), Mute, Solo, Color |
| **Cambio de tono (Pitch shifting)** | Transposición global o por pista (−24 a +24 semitonos) con presets de calidad |
| **Motor de reproducción** | Web Audio API con medición en tiempo real |
| **Zoom y scroll** | Navegación fluida en la línea de tiempo, seguimiento del playhead |
| **Importación de audio** | Drag-and-drop WAV/MP3 (hasta 50 MB, validados) |
| **Persistencia de proyectos** | Estado completo guardado en backend (SQLite) |

### 🔐 Autenticación y Seguridad
- **Auth basada en JWT** (HS256, expiración configurable)
- **Hash de contraseñas con bcrypt**
- **Rutas API protegidas** con inyección de dependencias
- **Provisionamiento de admin** mediante variables de entorno
- **Política CORS** restringida a orígenes configurados
- **Validación de subida de archivos** (MIME + magic bytes + límites de tamaño)

---

## 🏗 Arquitectura

```
├── client/                    # Frontend Angular 22
│   ├── src/
│   │   ├── app/
│   │   │   ├── core/          # Servicios compartidos (Metronome, Auth guard)
│   │   │   ├── features/      # Módulos de funcionalidades
│   │   │   │   ├── auth/      # Página de login
│   │   │   │   ├── daw/       # Componentes y servicios del DAW
│   │   │   │   ├── home/      # Página de inicio
│   │   │   │   ├── metronome/ # Página del metrónomo
│   │   │   │   └── songs/     # Visualizador y Modificar
│   │   │   ├── layout/        # Menú, shell
│   │   │   └── app.routes.ts  # Definición de rutas (lazy-loaded)
│   │   ├── assets/            # Assets estáticos, scripts integrados
│   │   └── styles.scss        # SCSS global
│   └── proxy.conf.json        # Proxy dev /api → localhost:8000
│
└── server/                    # Backend FastAPI
    ├── main.py                # Factory de app, middleware, routers
    ├── models.py              # Modelos SQLAlchemy (Song, DawProject, DawTrack, User)
    ├── database.py            # Engine, sesión, Base
    ├── auth.py                # JWT, bcrypt, provisionamiento de usuarios
    ├── dependencies.py        # Sesión BD, usuario actual
    ├── routers/
    │   ├── auth.py            # /api/auth/login, /me
    │   ├── songs.py           # /api/songs CRUD
    │   └── daw.py             # /api/daw proyectos, pistas, audio
    ├── schemas/               # Modelos Pydantic request/response
    ├── migrations/            # Helpers de migración de esquema
    ├── audio_uploads/         # Archivos de audio almacenados (gitignored)
    ├── songs.db               # Base de datos SQLite (gitignored)
    └── requirements.txt       # Dependencias Python
```

---

## 🚀 Inicio Rápido

### Prerrequisitos
- **Node.js** ≥ 20 (LTS recomendado)
- **Python** ≥ 3.13
- **npm** ≥ 10

### 1. Clonar y Configurar

```bash
git clone https://github.com/tu-usuario/acordes-y-letras.git
cd acordes-y-letras
```

#### Entorno Backend
```bash
cd server
cp .env.example .env
# Edita .env con valores seguros:
#   SECRET_KEY=<string aleatorio de 32+ caracteres>
#   ADMIN_PASSWORD=<contraseña robusta>
#   ALLOWED_ORIGINS=http://localhost:4200
#   UPLOAD_DIR=./audio_uploads
#   MAX_UPLOAD_SIZE=52428800
```

#### Frontend (sin configuración extra para desarrollo)

### 2. Instalar Dependencias

```bash
# Backend
cd server
python -m venv venv
# Windows:
venv\Scripts\activate
# Unix/macOS:
source venv/bin/activate
pip install -r requirements.txt

# Frontend
cd ../client
npm install
```

### 3. Ejecutar Servidores de Desarrollo

**Terminal 1 — Backend** (puerto 8000)
```bash
cd server
# Asegúrate de que el venv esté activado
uvicorn main:app --reload
```

**Terminal 2 — Frontend** (puerto 4200)
```bash
cd client
ng serve
```

Abre <http://localhost:4200> → serás redirigido a `/login`.

**Admin por defecto** (desde `.env`):
- Usuario: `ADMIN` (o `ADMIN_USERNAME`)
- Contraseña: tu `ADMIN_PASSWORD`

---

## 🔧 Configuración

### Backend (.env)

| Variable | Requerida | Default | Descripción |
|----------|-----------|---------|-------------|
| `SECRET_KEY` | ✅ | — | ≥32 chars, usada para firmar JWT |
| `ADMIN_PASSWORD` | ✅ | — | Contraseña inicial del usuario admin |
| `ADMIN_USERNAME` | ❌ | `ADMIN` | Nombre de usuario admin |
| `ADMIN_EMAIL` | ❌ | `admin@example.test` | Email admin |
| `ALGORITHM` | ❌ | `HS256` | Algoritmo JWT |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | ❌ | `30` | Vida del token en minutos |
| `ALLOWED_ORIGINS` | ❌ | `http://localhost:4200` | Orígenes CORS (separados por coma) |
| `UPLOAD_DIR` | ❌ | `./audio_uploads` | Directorio de almacenamiento de audio |
| `MAX_UPLOAD_SIZE` | ❌ | `52428800` | Tamaño máx. de subida en bytes (50 MB) |

### Frontend (proxy.conf.json)
Redirige `/api/*` a `http://localhost:8000` durante `ng serve`.

---

## 📚 Referencia de API

### Autenticación
```
POST   /api/auth/login          # Obtener access token
GET    /api/auth/me             # Perfil del usuario actual
```

### Canciones
```
POST   /api/songs/              # Crear canción
GET    /api/songs/              # Listar canciones (paginado)
GET    /api/songs/{id}          # Obtener canción
PUT    /api/songs/{id}          # Actualizar canción
DELETE /api/songs/{id}          # Eliminar canción
```

### Proyectos DAW
```
POST   /api/daw/projects/                       # Crear proyecto
GET    /api/daw/projects/                       # Listar proyectos
GET    /api/daw/projects/{id}                   # Obtener proyecto con pistas
PUT    /api/daw/projects/{id}                   # Actualizar proyecto
DELETE /api/daw/projects/{id}                   # Eliminar proyecto
POST   /api/daw/projects/{id}/tracks/           # Añadir pista (multipart: audio + metadata)
GET    /api/daw/projects/{id}/tracks/           # Listar pistas
GET    /api/daw/tracks/{id}                     # Obtener pista
GET    /api/daw/tracks/{id}/audio               # Stream de archivo de audio
PUT    /api/daw/tracks/{id}                     # Actualizar pista (volumen, pan, etc.)
PUT    /api/daw/tracks/{id}/audio               # Reemplazar audio de pista
DELETE /api/daw/tracks/{id}                     # Eliminar pista
```

Todos los endpoints (excepto `/api/auth/login` y `/api/hello`) requieren `Authorization: Bearer <token>`.

---

## 🧪 Testing

```bash
# Tests unitarios frontend (Vitest)
cd client && ng test

# Tests backend (pytest)
cd server && pytest
```

---

## 🏗 Build de Producción

```bash
# Frontend
cd client
ng build --configuration production
# Salida: client/dist/client/browser/

# Backend
cd server
# Usar servidor WSGI de producción (ej. gunicorn + workers uvicorn)
gunicorn -k uvicorn.workers.UvicornWorker main:app
```

**Notas de despliegue:**
- Servir `dist/` de Angular vía Nginx o hosting estático
- Ejecutar FastAPI detrás de proxy reverso (Nginx, Traefik, Caddy)
- Usar PostgreSQL en producción (cambiar `sqlite` en `database.py`)
- Configurar `SECRET_KEY` seguro, restringir `ALLOWED_ORIGINS`
- Apuntar `UPLOAD_DIR` a un volumen persistente

---

## 🛠 Flujo de Desarrollo

### Estilo de Código
- **Frontend**: Prettier (`npx prettier --write .`)
- **Backend**: Black + Ruff (añadir a `requirements.txt` si se desea)

### Git Hooks (recomendado)
```bash
# Instalar pre-commit
pip install pre-commit && pre-commit install
```

### Añadir una Funcionalidad
1. Backend: Añadir modelo → schema → router → registrar en `main.py`
2. Frontend: Generar componente (`ng g c features/...`) → añadir ruta → conectar servicio
3. Actualizar este README si es visible para el usuario

---

## 📁 Destacados de la Estructura del Proyecto

### Servicios Frontend (client/src/app)
| Servicio | Propósito |
|----------|-----------|
| `MetronomeService` | Scheduler Web Audio, compartido entre páginas |
| `SongService` | Cliente HTTP para `/api/songs` |
| `DawService` | Estado + motor Web Audio del DAW |
| `DawPitchService` | Pitch shifting offline (Rubber Band / custom) |
| `TransposeService` | Lógica de transposición de acordes en texto |
| `ExportService` | Generación TXT/PDF |
| `FileImportService` | Parseo de formato `.txt` de canciones |

### Módulos Backend (server/)
| Módulo | Responsabilidad |
|--------|-----------------|
| `auth.py` | Emisión/validación JWT, hash de contraseñas, bootstrap admin |
| `database.py` | Engine SQLAlchemy, factory de sesiones, base declarativa |
| `models.py` | Modelos ORM: `User`, `Song`, `DawProject`, `DawTrack` |
| `routers/songs.py` | CRUD de canciones con ownership |
| `routers/daw.py` | CRUD proyecto/pista, subida/stream de audio, limpieza |
| `schemas/daw.py` | Modelos Pydantic para contratos API del DAW |

---

## 🤝 Contribuir

1. Haz fork del repositorio
2. Crea una rama: `git checkout -b feature/nueva-funcionalidad`
3. Haz commit: `git commit -m 'feat: añadir nueva funcionalidad'`
4. Push a la rama: `git push origin feature/nueva-funcionalidad`
5. Abre un Pull Request

**Convención de commits**: [Conventional Commits](https://www.conventionalcommits.org/)  
(`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `style:`)

---

## 📄 Licencia

Distribuido bajo la Licencia MIT. Ver `LICENSE` para más información.

---

## 🙏 Agradecimientos

- [Angular](https://angular.dev/) — Plataforma web moderna
- [FastAPI](https://fastapi.tiangolo.com/) — APIs Python rápidas y type-safe
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) — Fundación del motor de audio
- [SQLAlchemy](https://www.sqlalchemy.org/) — Toolkit SQL para Python
- [Pydantic](https://docs.pydantic.dev/) — Validación de datos

---

<p align="center">
  Hecho con ❤️ para músicos de todo el mundo
</p>