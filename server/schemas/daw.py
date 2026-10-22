from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class DawProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    tempo: int = Field(default=120, ge=20, le=300)
    time_signature: str = Field(default="4/4", max_length=10)
    transpose: int = Field(default=0, ge=-24, le=24)


class DawProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    tempo: Optional[int] = Field(default=None, ge=20, le=300)
    time_signature: Optional[str] = Field(default=None, max_length=10)
    transpose: Optional[int] = Field(default=None, ge=-24, le=24)


class DawTrackCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    volume: float = Field(default=1.0, ge=0, le=10)
    pan: float = Field(default=0.0, ge=-1, le=1)
    muted: bool = False
    solo: bool = False
    clip_offset: float = Field(default=0.0, ge=0)
    clip_duration: float = Field(gt=0)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    source_offset: float = Field(default=0.0, ge=0)
    pitch_semitones: int = Field(default=0, ge=-24, le=24)


class DawTrackUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    volume: Optional[float] = Field(default=None, ge=0, le=10)
    pan: Optional[float] = Field(default=None, ge=-1, le=1)
    muted: Optional[bool] = None
    solo: Optional[bool] = None
    clip_offset: Optional[float] = Field(default=None, ge=0)
    clip_duration: Optional[float] = Field(default=None, gt=0)
    color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    source_offset: Optional[float] = Field(default=None, ge=0)
    pitch_semitones: Optional[int] = Field(default=None, ge=-24, le=24)


class DawTrackResponse(DawTrackCreate):
    id: int
    project_id: int
    audio_file_path: str
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class DawProjectResponse(DawProjectCreate):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    tracks: List[DawTrackResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)
