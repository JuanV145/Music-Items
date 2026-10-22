from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def migrate_daw_schema(engine: Engine, legacy_owner_id: int) -> None:
    """Add DAW ownership and track metadata columns to existing SQLite databases."""
    inspector = inspect(engine)
    if "daw_projects" not in inspector.get_table_names():
        return

    project_columns = {column["name"] for column in inspector.get_columns("daw_projects")}
    track_columns = {column["name"] for column in inspector.get_columns("daw_tracks")}
    with engine.begin() as connection:
        if "user_id" not in project_columns:
            connection.execute(text(
                "ALTER TABLE daw_projects ADD COLUMN user_id INTEGER REFERENCES users(id)"
            ))
            connection.execute(
                text("UPDATE daw_projects SET user_id = :owner_id WHERE user_id IS NULL"),
                {"owner_id": legacy_owner_id},
            )
        if "color" not in track_columns:
            connection.execute(text("ALTER TABLE daw_tracks ADD COLUMN color VARCHAR(7)"))
        if "source_offset" not in track_columns:
            connection.execute(text(
                "ALTER TABLE daw_tracks ADD COLUMN source_offset FLOAT NOT NULL DEFAULT 0"
            ))
        if "pitch_semitones" not in track_columns:
            connection.execute(text(
                "ALTER TABLE daw_tracks ADD COLUMN pitch_semitones INTEGER NOT NULL DEFAULT 0"
            ))

