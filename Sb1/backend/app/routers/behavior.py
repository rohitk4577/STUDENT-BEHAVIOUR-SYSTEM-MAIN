"""Behaviour data produced by the in-browser AI: label-change events and time totals."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.routers.subjects import get_subject_or_404

router = APIRouter(prefix="/api", tags=["Behaviour"])


@router.post("/events", response_model=schemas.EventOut, status_code=201)
def log_event(data: schemas.EventIn, db: Session = Depends(get_db)):
    get_subject_or_404(db, data.subject_id)
    event = models.BehaviorEvent(**data.model_dump())
    db.add(event)
    db.commit()
    return event


@router.get("/subjects/{subject_id}/events", response_model=list[schemas.EventOut])
def list_events(subject_id: str, limit: int = 100, db: Session = Depends(get_db)):
    get_subject_or_404(db, subject_id)
    return db.scalars(
        select(models.BehaviorEvent)
        .where(models.BehaviorEvent.subject_id == subject_id)
        .order_by(models.BehaviorEvent.id.desc())
        .limit(min(limit, 1000))
    ).all()


@router.get("/subjects/{subject_id}/behavior", response_model=dict[str, float])
def get_behavior_totals(subject_id: str, db: Session = Depends(get_db)):
    subject = get_subject_or_404(db, subject_id)
    return {s.behavior: s.seconds for s in subject.behavior_stats}


@router.put("/subjects/{subject_id}/behavior", response_model=dict[str, float])
def set_behavior_totals(subject_id: str, data: schemas.BehaviorTotals, db: Session = Depends(get_db)):
    """The page sends its running totals (seconds per behaviour); we store them as-is."""
    get_subject_or_404(db, subject_id)
    for behavior, seconds in data.seconds.items():
        stat = db.get(models.BehaviorStat, (subject_id, behavior))
        if stat is None:
            db.add(models.BehaviorStat(subject_id=subject_id, behavior=behavior, seconds=seconds))
        else:
            stat.seconds = seconds
    db.commit()
    return get_behavior_totals(subject_id, db)
