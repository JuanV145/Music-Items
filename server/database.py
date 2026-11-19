import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# SQLite por defecto; se puede sobrescribir con DATABASE_URL (p. ej. PostgreSQL).
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./songs.db")

# `check_same_thread` solo aplica a SQLite.
connect_args = {"check_same_thread": False} if SQLALCHEMY_DATABASE_URL.startswith("sqlite") else {}

# Create engine
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args=connect_args)

# Create session
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for models
Base = declarative_base()