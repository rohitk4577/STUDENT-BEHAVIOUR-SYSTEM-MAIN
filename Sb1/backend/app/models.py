"""
Database tables.

Subject ──< Student
   │  ├──< AttendanceSession   (one row per "Mark Attendance")
   │  ├──< FlaggedCase         (low-confidence matches waiting for faculty)
   │  ├──< BehaviorStat        (seconds spent per behaviour, from the live AI)
   │  └──< BehaviorEvent       (every label change the classifier made)

IDs of subjects, students and sessions are strings chosen by the browser
(e.g. "sub-1712345"), so the page can keep working offline and sync later.
"""
from datetime import datetime, timezone

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Subject(Base):
    __tablename__ = "subjects"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(80))
    room: Mapped[str] = mapped_column(String(30), default="TBA")
    schedule: Mapped[str] = mapped_column(String(40), default="TBA")

    students: Mapped[list["Student"]] = relationship(back_populates="subject", cascade="all, delete-orphan")
    sessions: Mapped[list["AttendanceSession"]] = relationship(cascade="all, delete-orphan")
    flags: Mapped[list["FlaggedCase"]] = relationship(cascade="all, delete-orphan")
    behavior_stats: Mapped[list["BehaviorStat"]] = relationship(cascade="all, delete-orphan")
    events: Mapped[list["BehaviorEvent"]] = relationship(cascade="all, delete-orphan")


class Student(Base):
    __tablename__ = "students"
    __table_args__ = (UniqueConstraint("subject_id", "roll", name="uq_student_roll_per_subject"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    subject_id: Mapped[str] = mapped_column(ForeignKey("subjects.id"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    roll: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(10), default="Absent")  # Present | Absent | Flagged
    attendance_rate: Mapped[int] = mapped_column(Integer, default=0)
    avatar: Mapped[str] = mapped_column(String(500), default="")

    subject: Mapped[Subject] = relationship(back_populates="students")
    flags: Mapped[list["FlaggedCase"]] = relationship(cascade="all, delete-orphan")


class AttendanceSession(Base):
    __tablename__ = "attendance_sessions"

    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    subject_id: Mapped[str] = mapped_column(ForeignKey("subjects.id"), index=True)
    time: Mapped[str] = mapped_column(String(40), default=utc_now_iso)  # ISO-8601, UTC
    present: Mapped[int] = mapped_column(Integer)
    total: Mapped[int] = mapped_column(Integer)
    faces: Mapped[int] = mapped_column(Integer, default=0)
    attention: Mapped[int] = mapped_column(Integer, default=0)  # attention index 0-100
    source: Mapped[str] = mapped_column(String(12), default="live")  # live | simulated | sample


class FlaggedCase(Base):
    __tablename__ = "flagged_cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject_id: Mapped[str] = mapped_column(ForeignKey("subjects.id"), index=True)
    student_id: Mapped[str] = mapped_column(ForeignKey("students.id"), index=True)
    score: Mapped[int] = mapped_column(Integer)  # match confidence %
    reason: Mapped[str] = mapped_column(String(80))
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    approved: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    resolved_at: Mapped[str | None] = mapped_column(String(40), nullable=True)


class BehaviorStat(Base):
    __tablename__ = "behavior_stats"

    subject_id: Mapped[str] = mapped_column(ForeignKey("subjects.id"), primary_key=True)
    behavior: Mapped[str] = mapped_column(String(20), primary_key=True)
    seconds: Mapped[float] = mapped_column(Float, default=0.0)


class BehaviorEvent(Base):
    __tablename__ = "behavior_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject_id: Mapped[str] = mapped_column(ForeignKey("subjects.id"), index=True)
    student_name: Mapped[str] = mapped_column(String(60))
    behavior: Mapped[str] = mapped_column(String(20))
    attentive: Mapped[bool] = mapped_column(Boolean)
    reason: Mapped[str] = mapped_column(String(120), default="")
    source: Mapped[str] = mapped_column(String(12), default="live")
    created_at: Mapped[str] = mapped_column(String(40), default=utc_now_iso, index=True)
