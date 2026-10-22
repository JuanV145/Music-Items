import logging
import os
import uuid
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from dependencies import get_db, get_current_user
from models import DawProject, DawTrack, User
from schemas.daw import (
    DawProjectCreate,
    DawProjectResponse,
    DawProjectUpdate,
    DawTrackResponse,
    DawTrackUpdate,
)

router = APIRouter()
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./audio_uploads")
MAX_UPLOAD_SIZE = int(os.getenv("MAX_UPLOAD_SIZE", "52428800"))
ALLOWED_MIME_TYPES = {"audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3"}
ALLOWED_EXTENSIONS = {".wav", ".mp3"}
CHUNK_SIZE = 1024 * 1024


def project_for_user(db: Session, project_id: int, user: User) -> DawProject:
    project = db.query(DawProject).filter(
        DawProject.id == project_id,
        DawProject.user_id == user.id,
    ).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def track_for_user(db: Session, track_id: int, user: User) -> DawTrack:
    track = db.query(DawTrack).join(DawProject).filter(
        DawTrack.id == track_id,
        DawProject.user_id == user.id,
    ).first()
    if track is None:
        raise HTTPException(status_code=404, detail="Track not found")
    return track


def audio_path(filename: str) -> Path:
    if not filename or Path(filename).name != filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=404, detail="Audio not found")
    root = Path(UPLOAD_DIR).resolve()
    path = (root / filename).resolve()
    if path.parent != root:
        raise HTTPException(status_code=404, detail="Audio not found")
    return path


def _valid_audio_header(header: bytes, extension: str) -> bool:
    if extension == ".wav":
        return len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WAVE"
    return header.startswith(b"ID3") or (
        len(header) >= 2 and header[0] == 0xFF and (header[1] & 0xE0) == 0xE0
    )


async def store_audio(upload: UploadFile) -> str:
    extension = Path(upload.filename or "").suffix.lower()
    if extension not in ALLOWED_EXTENSIONS or upload.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=400, detail="Invalid audio format")

    root = Path(UPLOAD_DIR).resolve()
    root.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{extension}"
    destination = audio_path(filename)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    size = 0
    header = bytearray()
    try:
        with temporary.open("wb") as stored:
            while chunk := await upload.read(CHUNK_SIZE):
                size += len(chunk)
                if size > MAX_UPLOAD_SIZE:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail="Audio file exceeds the configured size limit",
                    )
                if len(header) < 12:
                    header.extend(chunk[: 12 - len(header)])
                stored.write(chunk)
        if not size or not _valid_audio_header(bytes(header), extension):
            raise HTTPException(status_code=400, detail="Audio content does not match its extension")
        os.replace(temporary, destination)
        return filename
    except Exception:
        temporary.unlink(missing_ok=True)
        destination.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()


def remove_unreferenced_audio(db: Session, filename: str) -> None:
    if db.query(DawTrack.id).filter(DawTrack.audio_file_path == filename).first() is not None:
        return
    try:
        audio_path(filename).unlink(missing_ok=True)
    except (OSError, HTTPException):
        logging.exception("Could not remove unreferenced DAW audio file")


@router.post("/api/daw/projects/", response_model=DawProjectResponse)
def create_daw_project(
    project: DawProjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db_project = DawProject(**project.model_dump(), user_id=current_user.id)
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project


@router.get("/api/daw/projects/", response_model=List[DawProjectResponse])
def read_daw_projects(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(DawProject).filter(DawProject.user_id == current_user.id).offset(max(0, skip)).limit(min(max(1, limit), 100)).all()


@router.get("/api/daw/projects/{project_id}", response_model=DawProjectResponse)
def read_daw_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return project_for_user(db, project_id, current_user)


@router.put("/api/daw/projects/{project_id}", response_model=DawProjectResponse)
def update_daw_project(
    project_id: int,
    project: DawProjectUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db_project = project_for_user(db, project_id, current_user)
    for key, value in project.model_dump(exclude_unset=True).items():
        setattr(db_project, key, value)
    db.commit()
    db.refresh(db_project)
    return db_project


@router.delete("/api/daw/projects/{project_id}")
def delete_daw_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = project_for_user(db, project_id, current_user)
    audio_files = [track.audio_file_path for track in project.tracks]
    db.delete(project)
    db.commit()
    for filename in audio_files:
        remove_unreferenced_audio(db, filename)
    return {"message": "Project deleted successfully"}


@router.post("/api/daw/projects/{project_id}/tracks/", response_model=DawTrackResponse)
async def create_daw_track(
    project_id: int,
    name: str = Form(..., min_length=1, max_length=200),
    clip_duration: float = Form(..., gt=0),
    volume: float = Form(1.0, ge=0, le=10),
    pan: float = Form(0.0, ge=-1, le=1),
    muted: bool = Form(False),
    solo: bool = Form(False),
    clip_offset: float = Form(0.0, ge=0),
    color: Optional[str] = Form(None, pattern=r"^#[0-9a-fA-F]{6}$"),
    source_offset: float = Form(0.0, ge=0),
    pitch_semitones: int = Form(0, ge=-24, le=24),
    audio_file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project_for_user(db, project_id, current_user)
    filename = await store_audio(audio_file)
    track = DawTrack(
        project_id=project_id, name=name, audio_file_path=filename,
        volume=volume, pan=pan, muted=muted, solo=solo,
        clip_offset=clip_offset, clip_duration=clip_duration, color=color,
        source_offset=source_offset, pitch_semitones=pitch_semitones,
    )
    try:
        db.add(track)
        db.commit()
        db.refresh(track)
    except Exception:
        db.rollback()
        audio_path(filename).unlink(missing_ok=True)
        raise
    return track


@router.get("/api/daw/projects/{project_id}/tracks/", response_model=List[DawTrackResponse])
def read_daw_tracks(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project_for_user(db, project_id, current_user)
    return db.query(DawTrack).filter(DawTrack.project_id == project_id).all()


@router.get("/api/daw/tracks/{track_id}", response_model=DawTrackResponse)
def read_daw_track(
    track_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return track_for_user(db, track_id, current_user)


@router.get("/api/daw/tracks/{track_id}/audio")
def read_daw_track_audio(
    track_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    track = track_for_user(db, track_id, current_user)
    path = audio_path(track.audio_file_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Audio not found")
    return FileResponse(path, media_type="application/octet-stream", filename=path.name)


@router.put("/api/daw/tracks/{track_id}", response_model=DawTrackResponse)
def update_daw_track(
    track_id: int,
    changes: DawTrackUpdate = Body(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    track = track_for_user(db, track_id, current_user)
    for key, value in changes.model_dump(exclude_unset=True).items():
        setattr(track, key, value)
    db.commit()
    db.refresh(track)
    return track


@router.put("/api/daw/tracks/{track_id}/audio", response_model=DawTrackResponse)
async def replace_daw_track_audio(
    track_id: int,
    audio_file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    track = track_for_user(db, track_id, current_user)
    old_filename = track.audio_file_path
    new_filename = await store_audio(audio_file)
    track.audio_file_path = new_filename
    try:
        db.commit()
        db.refresh(track)
    except Exception:
        db.rollback()
        audio_path(new_filename).unlink(missing_ok=True)
        raise
    remove_unreferenced_audio(db, old_filename)
    return track


@router.delete("/api/daw/tracks/{track_id}")
def delete_daw_track(
    track_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    track = track_for_user(db, track_id, current_user)
    filename = track.audio_file_path
    db.delete(track)
    db.commit()
    remove_unreferenced_audio(db, filename)
    return {"message": "Track deleted successfully"}
