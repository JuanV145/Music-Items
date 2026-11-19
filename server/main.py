import logging
import os

from dotenv import load_dotenv

load_dotenv()  # take environment variables from .env

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

import auth
from database import Base, SessionLocal, engine
from models import DawProject, DawTrack, Song
from routers.daw import UPLOAD_DIR, router as daw_router
from routers.songs import router as songs_router
from routers.auth import router as auth_router
from migrations import migrate_daw_schema

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("acordes.api")

auth.get_secret_key()
admin_password = os.getenv("ADMIN_PASSWORD")
if not admin_password:
    raise RuntimeError("ADMIN_PASSWORD must be configured before starting the server")

# Create tables
Base.metadata.create_all(bind=engine)

with SessionLocal() as db:
    auth.provision_admin(
        db,
        username=os.getenv("ADMIN_USERNAME", "ADMIN"),
        password=admin_password,
        email=os.getenv("ADMIN_EMAIL", "admin@example.test"),
    )
    migrate_daw_schema(engine, legacy_owner_id=auth.get_user(db, os.getenv("ADMIN_USERNAME", "ADMIN")).id)

app = FastAPI()

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    # Conserva cabeceras como WWW-Authenticate (401) o Allow (405).
    headers = getattr(exc, "headers", None)
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=headers,
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )

# Configure CORS
allowed_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:4200").split(",")
allowed_origins = [origin.strip() for origin in allowed_origins if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create directory for private audio uploads if it doesn't exist
os.makedirs(UPLOAD_DIR, exist_ok=True)

app.include_router(auth_router)
app.include_router(songs_router)
app.include_router(daw_router)


@app.get("/")
def read_root():
    return {
        "name": "Acordes y Letras API",
        "status": "ok",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)


@app.get("/api/hello")
def read_hello():
    return {"message": "Hello from FastAPI backend"}