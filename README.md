# Acordes y Letras — Aplicación Full-Stack para Músicos

[![Angular](https://img.shields.io/badge/Angular-22.1-DD0031?logo=angular&logoColor=white)](https://angular.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.141-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python&logoColor=white)](https://python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)

> **Una aplicación web completa para músicos** — gestiona canciones con acordes y letras, practica con un metrónomo profesional y produce audio en un DAW (Digital Audio Workstation) basado en navegador.

---

## ✨ Características

### 🎵 Gestión de Canciones
| Función | Descripción |
|---------|-------------|
| **Visualizador** | Visualiza canciones con vista previa sincronizada de acordes/letras, filtros **Solo letra** / **Solo acordes**, transposición en tiempo real e integración con metrónomo |
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
| **Importación de audio** | Carga local de WAV/MP3/FLAC/OGG/M4A; la API de subida valida MIME, magic bytes y tamaño (máx. 50 MB) |
| **Persistencia** | Guardado manual (`💾 Guardar` o `Ctrl+S`) y **autoguardado** de proyectos vía API: audio original por pista, volumen, paneo, mute/solo, recortes, color y pitch. Los cambios sin guardar y la hora del último guardado se indican en la barra superior |
| **Deshacer / rehacer** | Historial de hasta 50 pasos con `Ctrl+Z`, `Ctrl+Shift+Z` o `Ctrl+Y` y botones ↶ ↷. Los cambios rápidos del mismo gesto (arrastrar un fader, mover o recortar un clip) se agrupan en un solo paso |
| **Recuperación** | Si el autoguardado falla, reintenta con backoff (5 s → 60 s) sin bloquear la edición. Al volver a entrar se ofrece recuperar la última sesión guardada mediante un marcador local (`daw:last-project`) |

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
    ├── main.py                # App FastAPI, handlers de error, CORS y routers
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
- **Node.js** ≥ 20 (22 LTS recomendado)
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
# Crea el archivo .env a mano con estos valores:
#   SECRET_KEY=<string aleatorio de 32+ caracteres>
#   ADMIN_PASSWORD=<contraseña robusta>
#   ALLOWED_ORIGINS=http://localhost:4200
#   UPLOAD_DIR=./audio_uploads
#   MAX_UPLOAD_SIZE=52428800
```

Genera un `SECRET_KEY` seguro con:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
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
| `ACCESS_TOKEN_EXPIRE_MINUTES` | ❌ | `0` | Vida del token en minutos; `0` = no caduca (sesión hasta el logout) |
| `ALLOWED_ORIGINS` | ❌ | `http://localhost:4200` | Orígenes CORS (separados por coma) |
| `DATABASE_URL` | ❌ | `sqlite:///./songs.db` | URL SQLAlchemy (`postgresql+psycopg2://…` en producción) |
| `UPLOAD_DIR` | ❌ | `./audio_uploads` | Directorio de almacenamiento de audio |
| `MAX_UPLOAD_SIZE` | ❌ | `52428800` | Tamaño máx. de subida en bytes (50 MB) |
| `LOG_LEVEL` | ❌ | `INFO` | Nivel de logging (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |

### Frontend (proxy.conf.json)
Redirige `/api/*` a `http://localhost:8000` durante `ng serve`.

---

## 📚 Referencia de API

### Autenticación
```
POST   /api/auth/login          # Obtener access token
GET    /api/auth/me             # Perfil del usuario actual
```

### Estado
```
GET    /                        # Información de la API
GET    /health                  # Health check (público)
GET    /api/hello               # Endpoint de prueba (público)
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
PUT    /api/daw/projects/{id}                   # Actualizar proyecto (expected_version opcional)
DELETE /api/daw/projects/{id}                   # Eliminar proyecto
POST   /api/daw/projects/{id}/tracks/           # Añadir pista (multipart: audio + metadata)
GET    /api/daw/projects/{id}/tracks/           # Listar pistas
GET    /api/daw/tracks/{id}                     # Obtener pista
GET    /api/daw/tracks/{id}/audio               # Stream de archivo de audio
PUT    /api/daw/tracks/{id}                     # Actualizar pista (volumen, pan, etc.)
PUT    /api/daw/tracks/{id}/audio               # Reemplazar audio de pista
DELETE /api/daw/tracks/{id}                     # Eliminar pista
```

Todos los endpoints (excepto `/`, `/health`, `/api/hello` y `/api/auth/login`) requieren `Authorization: Bearer <token>`.

> **Persistencia del DAW:** se sube el audio **original** de cada pista (WAV/MP3 tal cual; otros formatos se recodifican a WAV) y el pitch se guarda aparte en `pitch_semitones`; al abrir un proyecto se descarga el original y se vuelve a renderizar el pitch en el navegador. Las pistas eliminadas de la sesión se borran en el servidor solo al guardar, para que descartar cambios no destruya audio.

> **Bloqueo optimista:** cada proyecto expone una `version` que se incrementa en cada guardado. El `PUT` acepta `expected_version` y responde **409 Conflict** si otra pestaña o equipo ya guardó una versión más reciente; el autoguardado se detiene y la interfaz ofrece «Recargar del servidor» (descarta lo local) o «Sobrescribir» (adopta la versión del servidor y sube la sesión actual). En bases de datos existentes la columna se añade con valor `1` al arrancar.

> **Autoguardado:** tras ~2,5 s sin cambios persistibles se guarda en silencio (el botón manual y `Ctrl+S` siguen disponibles). Si falla, se reintenta con backoff exponencial y el estado muestra «Sin conexión · reintentando»; nunca se abren alertas por un fallo de red. Al guardar se escribe el marcador `daw:last-project` en `localStorage` (solo `id`, nombre y fecha), que permite ofrecer «Recuperar» la última sesión al entrar de nuevo en el DAW. El marcador no duplica audio: los datos siguen en la base de datos y en `audio_uploads/`.

> **Deshacer/rehacer:** el historial vive en `DawService` como instantáneas ligeras (las pistas se copian superficialmente y los `AudioBuffer` se comparten por referencia), limitado a 50 pasos. Cubre añadir/eliminar pistas, volumen, paneo, mute/solo, nombre, color, recortes/movimiento de clips, tempo y nombre del proyecto. Deshacer marca la sesión como sucia, así que el autoguardado persiste el estado restaurado. Cambiar el pitch queda fuera del historial y lo vacía, porque sus instantáneas dejarían de coincidir con el audio renderizado. Si una pista restaurada ya se había borrado en el servidor, al guardar se vuelve a crear en lugar de fallar.

> **Nota:** las canciones no tienen `user_id`; el modelo actual es monousuario (solo se aprovisiona el admin). No hay aislamiento de datos entre usuarios.

---

## 🧪 Testing

```bash
# Tests unitarios frontend (Vitest, una sola ejecución)
cd client && npx ng test --watch=false

# Tests backend (pytest)
cd server && pytest -q
```

---

## 🏗 Build de Producción

```bash
# Frontend
cd client
ng build --configuration production
# Salida: client/dist/client/browser/

# Backend (ejemplo con uvicorn; añade gunicorn si lo necesitas)
cd server
uvicorn main:app --host 0.0.0.0 --port 8000
```

**Notas de despliegue:**
- Servir `dist/` de Angular vía Nginx o hosting estático
- Ejecutar FastAPI detrás de proxy reverso (Nginx, Traefik, Caddy)
- Usar PostgreSQL en producción definiendo `DATABASE_URL` (el driver `psycopg2-binary` ya está en `requirements.txt`)
- Configurar `SECRET_KEY` seguro, restringir `ALLOWED_ORIGINS`
- Apuntar `UPLOAD_DIR` a un volumen persistente
- Fijar `ACCESS_TOKEN_EXPIRE_MINUTES` a un valor positivo en producción

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
| `DawProjectService` | Cliente HTTP de proyectos y pistas del DAW (multipart y descarga de audio) |
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
| `routers/songs.py` | CRUD de canciones (modelo monousuario, sin ownership) |
| `routers/daw.py` | CRUD proyecto/pista, subida/stream de audio, limpieza |
| `schemas/daw.py` | Modelos Pydantic para contratos API del DAW |

---
