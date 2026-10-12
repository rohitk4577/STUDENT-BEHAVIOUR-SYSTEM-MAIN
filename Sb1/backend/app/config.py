"""
Settings, read from environment variables with sensible defaults so the
project runs with no configuration at all.
"""
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent          # Sb1/backend
FRONTEND_DIR = Path(os.getenv("CLASSSIGHT_FRONTEND_DIR", BACKEND_DIR.parent / "FRONTEND"))

# SQLite file next to the backend code. Any SQLAlchemy URL works here,
# e.g. postgresql://user:pass@localhost/classsight
DATABASE_URL = os.getenv(
    "CLASSSIGHT_DATABASE_URL",
    f"sqlite:///{(BACKEND_DIR / 'classsight.db').as_posix()}",
)

APP_NAME = "ClassSight API"
