import os
from datetime import datetime, timedelta
from typing import Optional, Union

from fastapi import HTTPException
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

import models
from database import SessionLocal

ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))


def get_secret_key():
    secret_key = os.getenv("SECRET_KEY", "")
    placeholders = {
        "your-secret-key-here",
        "09d25e094faa6ca2556c818166b7a9563b93f7099f6f0f4caa6cf63b88e8d3e7",
    }
    if len(secret_key.encode("utf-8")) < 32 or secret_key.lower() in placeholders:
        raise RuntimeError("SECRET_KEY must be configured with a random value of at least 32 characters")
    return secret_key

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password):
    return pwd_context.hash(password)


def get_user(db: Session, username: str):
    return db.query(models.User).filter(models.User.username == username).first()


def authenticate_user(db: Session, username: str, password: str):
    user = get_user(db, username)
    if not user:
        return False
    if not user.is_active or not verify_password(password, user.hashed_password):
        return False
    return user


def provision_admin(db: Session, username: str, password: str, email: str):
    user = get_user(db, username)
    if user is not None:
        return user

    user = models.User(
        username=username,
        email=email,
        hashed_password=get_password_hash(password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, get_secret_key(), algorithm=ALGORITHM)
    return encoded_jwt


def get_current_user_token(token: str, db: Session):
    credentials_exception = (
        "Could not validate credentials",
        401,
        {"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, get_secret_key(), algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(
                status_code=401,
                detail="Could not validate credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
    except JWTError:
        raise HTTPException(
            status_code=401,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = get_user(db, username=username)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=401,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user