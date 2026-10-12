"""Demo data loaded into an empty database (same data as the frontend's defaults)."""
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app import models


def _avatar(photo_id: str) -> str:
    return f"https://images.unsplash.com/photo-{photo_id}?q=80&w=200&auto=format&fit=crop"


SUBJECTS = [
    ("sub-1", "CS-302", "Neural Networks & Deep Learning", "Lab 402", "Mon/Wed 10:00 AM"),
    ("sub-2", "CS-401", "Computer Vision & Optics", "Hall B", "Tue/Thu 02:00 PM"),
    ("sub-3", "EC-201", "Digital Signal Processing", "Room 105", "Fri 09:00 AM"),
]

STUDENTS = [
    ("std-1", "Ananya Sharma", "CS2026-014", "Present", 94, "1534528741775-53994a69daeb"),
    ("std-2", "Rohan Mehta", "CS2026-019", "Present", 88, "1507003211169-0a1dd7228f2d"),
    ("std-3", "Priya Nair", "CS2026-022", "Present", 96, "1494790108377-be9c29b29330"),
    ("std-4", "Aarav Patel", "CS2026-005", "Present", 90, "1500648767791-00dcc994a43e"),
    ("std-5", "Siddharth Das", "CS2026-031", "Flagged", 68, "1522075469751-3a6694fb2f61"),
    ("std-6", "Kavya Iyer", "CS2026-027", "Flagged", 72, "1517841905240-472988babdf9"),
    ("std-7", "Neha Gupta", "CS2026-011", "Absent", 60, "1544005313-94ddf0286df2"),
    ("std-8", "Aditya Rao", "CS2026-003", "Absent", 55, "1506794778202-cad84cf45f1d"),
]


def seed_demo_data(db: Session) -> None:
    for sid, code, name, room, schedule in SUBJECTS:
        db.add(models.Subject(id=sid, code=code, name=name, room=room, schedule=schedule))
    for sid, name, roll, status, rate, photo in STUDENTS:
        db.add(models.Student(id=sid, subject_id="sub-1", name=name, roll=roll, status=status,
                              attendance_rate=rate, avatar=_avatar(photo)))
    db.flush()  # students must exist before flags reference them
    db.add(models.FlaggedCase(subject_id="sub-1", student_id="std-5", score=64, reason="Partial face occlusion"))
    db.add(models.FlaggedCase(subject_id="sub-1", student_id="std-6", score=61, reason="Low classroom lighting"))

    now = datetime.now(timezone.utc)
    db.add(models.AttendanceSession(id="s-1", subject_id="sub-1", time=(now - timedelta(days=2)).isoformat(),
                                    present=7, total=8, faces=7, attention=89, source="sample"))
    db.add(models.AttendanceSession(id="s-2", subject_id="sub-1", time=(now - timedelta(days=1)).isoformat(),
                                    present=6, total=8, faces=6, attention=84, source="sample"))
    db.commit()


def seed_if_empty(db: Session) -> None:
    if db.scalar(select(models.Subject.id).limit(1)) is None:
        seed_demo_data(db)


def reset_to_demo_data(db: Session) -> None:
    # Children first, so foreign keys are never left dangling.
    for table in (models.BehaviorEvent, models.BehaviorStat, models.FlaggedCase,
                  models.AttendanceSession, models.Student, models.Subject):
        db.execute(delete(table))
    db.commit()
    seed_demo_data(db)
