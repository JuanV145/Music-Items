import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import auth
import dependencies
import models
from database import Base
from migrations import migrate_daw_schema
from routers import daw as daw_router


@pytest.fixture
def daw_client(tmp_path, monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = session_factory()
    app = FastAPI()
    app.include_router(daw_router.router)
    app.dependency_overrides[dependencies.get_db] = lambda: db
    monkeypatch.setattr(daw_router, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setenv("SECRET_KEY", "test-secret-key-that-is-long-enough")

    users = []
    for username in ("alice", "bob"):
        user = models.User(
            username=username,
            email=f"{username}@example.test",
            hashed_password=auth.get_password_hash("password"),
        )
        db.add(user)
        db.commit()
        users.append(user)
    tokens = {
        user.username: auth.create_access_token({"sub": user.username})
        for user in users
    }
    client = TestClient(app)

    yield client, db, tokens, tmp_path

    client.close()
    app.dependency_overrides.clear()
    db.close()
    engine.dispose()


def headers(tokens, username):
    return {"Authorization": f"Bearer {tokens[username]}"}


def test_projects_are_isolated_by_owner(daw_client):
    client, _, tokens, _ = daw_client
    created = client.post(
        "/api/daw/projects/",
        headers=headers(tokens, "alice"),
        json={"name": "Alice session", "time_signature": "7/8"},
    )
    project_id = created.json()["id"]

    assert created.status_code == 200
    assert created.json()["time_signature"] == "7/8"
    assert client.get("/api/daw/projects/", headers=headers(tokens, "bob")).json() == []
    assert client.get(
        f"/api/daw/projects/{project_id}", headers=headers(tokens, "bob")
    ).status_code == 404
    assert client.put(
        f"/api/daw/projects/{project_id}",
        headers=headers(tokens, "bob"),
        json={"name": "stolen"},
    ).status_code == 404
    assert client.delete(
        f"/api/daw/projects/{project_id}", headers=headers(tokens, "bob")
    ).status_code == 404


def test_track_metadata_round_trips_and_audio_is_private(daw_client):
    client, _, tokens, uploads = daw_client
    project = client.post(
        "/api/daw/projects/",
        headers=headers(tokens, "alice"),
        json={"name": "Mix", "time_signature": "5/4"},
    ).json()
    created = client.post(
        f"/api/daw/projects/{project['id']}/tracks/",
        headers=headers(tokens, "alice"),
        data={
            "name": "Piano",
            "clip_duration": "1.5",
            "clip_offset": "2.25",
            "volume": "0.7",
            "pan": "-0.25",
            "color": "#123456",
            "source_offset": "0.2",
            "pitch_semitones": "5",
        },
        files={"audio_file": ("piano.wav", b"RIFF\x00\x00\x00\x00WAVE", "audio/wav")},
    )

    assert created.status_code == 200
    track = created.json()
    assert track["clip_offset"] == pytest.approx(2.25)
    assert track["clip_duration"] == pytest.approx(1.5)
    assert track["color"] == "#123456"
    assert track["source_offset"] == pytest.approx(0.2)
    assert track["pitch_semitones"] == 5
    assert track["audio_file_path"] != "piano.wav"
    assert (uploads / track["audio_file_path"]).is_file()
    assert client.get(f"/api/daw/tracks/{track['id']}/audio").status_code == 401
    assert client.get(
        f"/api/daw/tracks/{track['id']}", headers=headers(tokens, "bob")
    ).status_code == 404
    assert client.put(
        f"/api/daw/tracks/{track['id']}", headers=headers(tokens, "bob"), json={"name": "stolen"}
    ).status_code == 404
    assert client.delete(
        f"/api/daw/tracks/{track['id']}", headers=headers(tokens, "bob")
    ).status_code == 404
    assert client.get(
        f"/api/daw/tracks/{track['id']}/audio", headers=headers(tokens, "bob")
    ).status_code == 404
    assert client.get(
        f"/api/daw/tracks/{track['id']}/audio", headers=headers(tokens, "alice")
    ).content.startswith(b"RIFF")

    updated = client.put(
        f"/api/daw/tracks/{track['id']}",
        headers=headers(tokens, "alice"),
        json={"name": "Keys", "muted": True, "clip_offset": 3.0, "pitch_semitones": -2},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Keys"
    assert updated.json()["muted"] is True
    assert updated.json()["clip_offset"] == pytest.approx(3.0)
    assert updated.json()["pitch_semitones"] == -2


def test_upload_filename_cannot_escape_or_collide(daw_client):
    client, _, tokens, uploads = daw_client
    project = client.post(
        "/api/daw/projects/", headers=headers(tokens, "alice"), json={"name": "Mix"}
    ).json()
    response = client.post(
        f"/api/daw/projects/{project['id']}/tracks/",
        headers=headers(tokens, "alice"),
        data={"name": "Audio", "clip_duration": "1"},
        files={"audio_file": ("../outside.wav", b"RIFF\x00\x00\x00\x00WAVE", "audio/wav")},
    )

    assert response.status_code == 200
    stored_name = response.json()["audio_file_path"]
    assert os.path.basename(stored_name) == stored_name
    assert (uploads / stored_name).is_file()
    assert not (uploads.parent / "outside.wav").exists()


def test_deleting_project_removes_its_audio(daw_client):
    client, _, tokens, uploads = daw_client
    project = client.post(
        "/api/daw/projects/", headers=headers(tokens, "alice"), json={"name": "Mix"}
    ).json()
    track = client.post(
        f"/api/daw/projects/{project['id']}/tracks/",
        headers=headers(tokens, "alice"),
        data={"name": "Audio", "clip_duration": "1"},
        files={"audio_file": ("mix.mp3", b"ID3audio", "audio/mpeg")},
    ).json()
    audio_path = uploads / track["audio_file_path"]
    assert audio_path.exists()

    deleted = client.delete(
        f"/api/daw/projects/{project['id']}", headers=headers(tokens, "alice")
    )

    assert deleted.status_code == 200
    assert not audio_path.exists()


def test_existing_database_migration_assigns_legacy_projects_to_admin():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY)")
        connection.exec_driver_sql("CREATE TABLE daw_projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
        connection.exec_driver_sql("CREATE TABLE daw_tracks (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL)")
        connection.exec_driver_sql("INSERT INTO daw_projects (id, name) VALUES (1, 'Legacy')")

    migrate_daw_schema(engine, legacy_owner_id=7)
    migrate_daw_schema(engine, legacy_owner_id=8)

    with engine.connect() as connection:
        owner_id = connection.exec_driver_sql(
            "SELECT user_id FROM daw_projects WHERE id = 1"
        ).scalar_one()
        track_columns = {column["name"] for column in inspect(engine).get_columns("daw_tracks")}
    assert owner_id == 7
    assert {"color", "source_offset", "pitch_semitones"}.issubset(track_columns)
    engine.dispose()
