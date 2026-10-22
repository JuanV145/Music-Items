import os
from dotenv import load_dotenv

load_dotenv()  # take environment variables from .env

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import auth
from database import Base, SessionLocal, engine
from models import DawProject, DawTrack, Song
from routers.daw import UPLOAD_DIR, router as daw_router
from routers.songs import router as songs_router
from routers.auth import router as auth_router
from migrations import migrate_daw_schema

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

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    # Log the exception here (we'll add logging later)
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


@app.get("/api/hello")
def read_hello():
    return {"message": "Hello from FastAPI backend"}