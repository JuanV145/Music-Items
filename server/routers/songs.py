from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from dependencies import get_db, get_current_user
from models import Song, User
from schemas.songs import SongCreate, SongResponse, SongUpdate

router = APIRouter()


@router.post("/api/songs/", response_model=SongResponse)
def create_song(song: SongCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_song = Song(**song.dict())
    db.add(db_song)
    db.commit()
    db.refresh(db_song)
    return db_song.to_dict()


@router.get("/api/songs/", response_model=List[SongResponse])
def read_songs(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    songs = db.query(Song).offset(skip).limit(limit).all()
    return [song.to_dict() for song in songs]


@router.get("/api/songs/{song_id}", response_model=SongResponse)
def read_song(song_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    song = db.query(Song).filter(Song.id == song_id).first()
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found")
    return song.to_dict()


@router.put("/api/songs/{song_id}", response_model=SongResponse)
def update_song(song_id: int, song: SongUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_song = db.query(Song).filter(Song.id == song_id).first()
    if db_song is None:
        raise HTTPException(status_code=404, detail="Song not found")

    update_data = song.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_song, key, value)

    db.commit()
    db.refresh(db_song)
    return db_song.to_dict()


@router.delete("/api/songs/{song_id}")
def delete_song(song_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    song = db.query(Song).filter(Song.id == song_id).first()
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found")

    db.delete(song)
    db.commit()
    return {"message": "Song deleted successfully"}