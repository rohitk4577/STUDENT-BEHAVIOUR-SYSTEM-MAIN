"""Student roster."""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models, schemas
from app.database import get_db
from app.routers.subjects import get_subject_or_404

router = APIRouter(prefix="/api/students", tags=["Students"])


def get_student_or_404(db: Session, student_id: str) -> models.Student:
    student = db.get(models.Student, student_id)
    if student is None:
        raise HTTPException(404, f"Student {student_id} not found")
    return student


@router.get("", response_model=list[schemas.StudentOut])
def list_students(subject_id: str | None = None, db: Session = Depends(get_db)):
    query = select(models.Student)
    if subject_id:
        query = query.where(models.Student.subject_id == subject_id)
    return db.scalars(query).all()


@router.post("", response_model=schemas.StudentOut, status_code=201)
def create_student(data: schemas.StudentIn, db: Session = Depends(get_db)):
    get_subject_or_404(db, data.subject_id)
    duplicate = db.scalar(select(models.Student).where(
        models.Student.subject_id == data.subject_id, func.lower(models.Student.roll) == data.roll.lower()))
    if duplicate:
        raise HTTPException(409, f"Roll number {data.roll} is already enrolled in this subject")
    student = models.Student(**data.model_dump(exclude={"id"}), id=data.id or f"std-{uuid.uuid4().hex[:10]}")
    db.add(student)
    db.commit()
    return student


@router.patch("/{student_id}", response_model=schemas.StudentOut)
def update_student(student_id: str, data: schemas.StudentUpdate, db: Session = Depends(get_db)):
    student = get_student_or_404(db, student_id)
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(student, field, value)
    db.commit()
    return student


@router.delete("/{student_id}", status_code=204)
def delete_student(student_id: str, db: Session = Depends(get_db)):
    db.delete(get_student_or_404(db, student_id))  # also removes their flagged cases
    db.commit()
