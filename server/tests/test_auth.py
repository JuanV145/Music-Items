import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import auth
import dependencies
import models
from database import Base
from routers.auth import get_db, router as auth_router
from routers.songs import router as songs_router

app = FastAPI()
app.include_router(auth_router)
app.include_router(songs_router)


def make_test_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)()


def test_admin_provisioning_hashes_password_and_is_idempotent():
    db = make_test_session()
    try:
        admin = auth.provision_admin(
            db,
            username="ADMIN",
            password="nevu",
            email="admin@example.test",
        )
        original_hash = admin.hashed_password

        assert original_hash != "nevu"
        assert auth.verify_password("nevu", original_hash)

        existing_admin = auth.provision_admin(
            db,
            username="ADMIN",
            password="different-password",
            email="admin@example.test",
        )

        assert existing_admin.id == admin.id
        assert existing_admin.hashed_password == original_hash
    finally:
        db.close()


def test_admin_can_log_in_and_registration_is_disabled(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "test-secret-key-that-is-long-enough")
    db = make_test_session()
    app.dependency_overrides[get_db] = lambda: db
    try:
        auth.provision_admin(
            db,
            username="ADMIN",
            password="nevu",
            email="admin@example.test",
        )
        db.add(models.User(
            username="previous-user",
            email="previous@example.test",
            hashed_password=auth.get_password_hash("old-password"),
        ))
        db.commit()
        client = TestClient(app)

        login_response = client.post(
            "/api/auth/token",
            data={"username": "ADMIN", "password": "nevu"},
        )
        registration_response = client.post(
            "/api/auth/register",
            json={"username": "other", "email": "other@example.test", "password": "password"},
        )
        previous_user_response = client.post(
            "/api/auth/token",
            data={"username": "previous-user", "password": "old-password"},
        )
        monkeypatch.setattr(
            dependencies,
            "SessionLocal",
            lambda: pytest.fail("authenticated requests must reuse the yielded database session"),
        )
        app.dependency_overrides[dependencies.get_db] = lambda: db
        song_response = client.post(
            "/api/songs/",
            headers={"Authorization": f"Bearer {login_response.json()['access_token']}"},
            json={
                "title": "Test song",
                "artist": "Test artist",
                "key_root": "C",
                "key_mode": "",
                "tempo": "120",
                "time_signature": "4/4",
                "chords_lyrics": "C  G  Am  F",
            },
        )

        assert login_response.status_code == 200
        assert song_response.status_code == 200
        assert song_response.json()["title"] == "Test song"
        assert previous_user_response.status_code == 401
        assert login_response.json()["token_type"] == "bearer"
        assert login_response.json()["access_token"]
        assert registration_response.status_code == 404
    finally:
        app.dependency_overrides.clear()
        db.close()


def test_token_creation_requires_a_configured_secret(monkeypatch):
    monkeypatch.delenv("SECRET_KEY", raising=False)

    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        auth.create_access_token({"sub": "ADMIN"})


def test_inactive_user_cannot_log_in_or_use_an_existing_token(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "test-secret-key-that-is-long-enough")
    db = make_test_session()
    try:
        user = models.User(
            username="disabled-admin",
            email="disabled@example.test",
            hashed_password=auth.get_password_hash("password"),
            is_active=False,
        )
        db.add(user)
        db.commit()
        token = auth.create_access_token({"sub": user.username})

        assert auth.authenticate_user(db, user.username, "password") is False
        with pytest.raises(HTTPException) as error:
            auth.get_current_user_token(token, db)
        assert error.value.status_code == 401
    finally:
        db.close()
