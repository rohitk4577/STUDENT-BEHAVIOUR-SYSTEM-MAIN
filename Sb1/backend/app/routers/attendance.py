"""Attendance sessions and the faculty verification queue."""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.models import utc_now_iso
from app.routers.subjects import get_subject_or_404

router = APIRouter(prefix="/api", tags=["Attendance"])


@router.get("/sessions", response_model=list[schemas.SessionOut])
def list_sessions(subject_id: str | None = None, db: Session = Depends(get_db)):
    query = select(models.AttendanceSession).order_by(models.AttendanceSession.time)
    if subject_id:
        query = query.where(models.AttendanceSession.subject_id == subject_id)
    return db.scalars(query).all()


@router.post("/sessions", response_model=schemas.SessionOut, status_code=201)
def create_session(data: schemas.SessionIn, db: Session = Depends(get_db)):
    """Saves one 'Mark Attendance' press and marks the detected students Present."""
    get_subject_or_404(db, data.subject_id)
    session = models.AttendanceSession(
        **data.model_dump(exclude={"id", "time", "present_student_ids"}),
        id=data.id or f"s-{uuid.uuid4().hex[:10]}",
        time=data.time or utc_now_iso(),
    )
    db.add(session)
    if data.present_student_ids:
        students = db.scalars(select(models.Student).where(
            models.Student.id.in_(data.present_student_ids),
            models.Student.subject_id == data.subject_id))
        for student in students:
            student.status = "Present"
    db.commit()
    return session


@router.get("/flags", response_model=list[schemas.FlagOut])
def list_open_flags(subject_id: str | None = None, db: Session = Depends(get_db)):
    query = select(models.FlaggedCase).where(models.FlaggedCase.resolved.is_(False))
    if subject_id:
        query = query.where(models.FlaggedCase.subject_id == subject_id)
    return db.scalars(query).all()


def _resolve(flag: models.FlaggedCase, approved: bool, db: Session) -> None:
    flag.resolved = True
    flag.approved = approved
    flag.resolved_at = utc_now_iso()
    student = db.get(models.Student, flag.student_id)
    if student:
        student.status = "Present" if approved else "Absent"


@router.post("/flags/{flag_id}/resolve", response_model=schemas.FlagOut)
def resolve_flag(flag_id: int, data: schemas.FlagResolve, db: Session = Depends(get_db)):
    flag = db.get(models.FlaggedCase, flag_id)
    if flag is None or flag.resolved:
        raise HTTPException(404, f"Open flagged case {flag_id} not found")
    _resolve(flag, data.approved, db)
    db.commit()
    return flag


@router.post("/subjects/{subject_id}/flags/approve-all")
def approve_all_flags(subject_id: str, db: Session = Depends(get_db)):
    get_subject_or_404(db, subject_id)
    flags = db.scalars(select(models.FlaggedCase).where(
        models.FlaggedCase.subject_id == subject_id, models.FlaggedCase.resolved.is_(False))).all()
    for flag in flags:
        _resolve(flag, True, db)
    db.commit()
    return {"approved": len(flags)}
