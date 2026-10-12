"""Subjects (courses) plus the per-subject report download."""
import csv
import io
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db

router = APIRouter(prefix="/api/subjects", tags=["Subjects"])


def get_subject_or_404(db: Session, subject_id: str) -> models.Subject:
    subject = db.get(models.Subject, subject_id)
    if subject is None:
        raise HTTPException(404, f"Subject {subject_id} not found")
    return subject


@router.get("", response_model=list[schemas.SubjectOut])
def list_subjects(db: Session = Depends(get_db)):
    return db.scalars(select(models.Subject)).all()


@router.post("", response_model=schemas.SubjectOut, status_code=201)
def create_subject(data: schemas.SubjectIn, db: Session = Depends(get_db)):
    if db.scalar(select(models.Subject).where(func.lower(models.Subject.code) == data.code.lower())):
        raise HTTPException(409, f"Subject code {data.code} already exists")
    subject = models.Subject(**data.model_dump(exclude={"id"}), id=data.id or f"sub-{uuid.uuid4().hex[:10]}")
    db.add(subject)
    db.commit()
    return subject


@router.delete("/{subject_id}", status_code=204)
def delete_subject(subject_id: str, db: Session = Depends(get_db)):
    subject = get_subject_or_404(db, subject_id)
    if db.query(models.Subject).count() <= 1:
        raise HTTPException(400, "Cannot delete the only subject")
    db.delete(subject)  # cascades to students, sessions, flags, stats and events
    db.commit()


@router.get("/{subject_id}/report.csv", response_class=Response)
def subject_report_csv(subject_id: str, db: Session = Depends(get_db)):
    """Roster with status, followed by every recorded attendance session."""
    subject = get_subject_or_404(db, subject_id)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Roll", "Name", "Subject", "Status", "Attendance %"])
    for s in subject.students:
        writer.writerow([s.roll, s.name, subject.code, s.status, s.attendance_rate])
    writer.writerow([])
    writer.writerow(["Session time (UTC)", "Present", "Total", "Faces detected", "Attention %", "Source"])
    for sess in sorted(subject.sessions, key=lambda x: x.time):
        writer.writerow([sess.time, sess.present, sess.total, sess.faces, sess.attention, sess.source])
    return Response(
        content="﻿" + out.getvalue(),  # BOM so Excel reads UTF-8 correctly
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="ClassSight_{subject.code}.csv"'},
    )
