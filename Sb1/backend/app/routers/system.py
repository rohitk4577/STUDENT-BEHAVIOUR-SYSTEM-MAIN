"""Health check, full-state load for the page, and demo reset."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.config import APP_NAME
from app.database import get_db
from app.seed import reset_to_demo_data

router = APIRouter(prefix="/api", tags=["System"])


@router.get("/health")
def health():
    return {"status": "ok", "app": APP_NAME}


@router.get("/state", response_model=schemas.StateOut)
def get_state(db: Session = Depends(get_db)):
    """Everything the page needs in one request, in the same shape as its in-memory store."""
    behavior: dict[str, dict[str, float]] = {}
    for stat in db.scalars(select(models.BehaviorStat)):
        behavior.setdefault(stat.subject_id, {})[stat.behavior] = stat.seconds
    return schemas.StateOut(
        subjects=db.scalars(select(models.Subject)).all(),
        students=db.scalars(select(models.Student)).all(),
        flagged_queue=db.scalars(select(models.FlaggedCase).where(models.FlaggedCase.resolved.is_(False))).all(),
        sessions=db.scalars(select(models.AttendanceSession).order_by(models.AttendanceSession.time)).all(),
        behavior_seconds=behavior,
    )


@router.post("/reset", response_model=schemas.StateOut)
def reset(db: Session = Depends(get_db)):
    reset_to_demo_data(db)
    return get_state(db)
