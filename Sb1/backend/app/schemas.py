"""
Request/response shapes (Pydantic). JSON uses camelCase (subjectId,
attendanceRate, ...) to match the JavaScript frontend; Python code uses
snake_case.
"""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

BehaviorKey = Literal["attentive", "notes", "hand_raised", "looking_away", "head_down", "phone", "drowsy"]
Status = Literal["Present", "Absent", "Flagged"]
Source = Literal["live", "simulated", "sample", "manual"]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


# ---- Subjects ----
class SubjectIn(CamelModel):
    id: str | None = Field(default=None, max_length=40)
    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=80)
    room: str = Field(default="TBA", max_length=30)
    schedule: str = Field(default="TBA", max_length=40)


class SubjectOut(CamelModel):
    id: str
    code: str
    name: str
    room: str
    schedule: str


# ---- Students ----
class StudentIn(CamelModel):
    id: str | None = Field(default=None, max_length=40)
    subject_id: str
    name: str = Field(min_length=1, max_length=60)
    roll: str = Field(min_length=1, max_length=20)
    status: Status = "Absent"
    attendance_rate: int = Field(default=0, ge=0, le=100)
    avatar: str = Field(default="", max_length=500)


class StudentUpdate(CamelModel):
    status: Status | None = None
    attendance_rate: int | None = Field(default=None, ge=0, le=100)


class StudentOut(CamelModel):
    id: str
    subject_id: str
    name: str
    roll: str
    status: str
    attendance_rate: int
    avatar: str


# ---- Attendance sessions ----
class SessionIn(CamelModel):
    id: str | None = Field(default=None, max_length=40)
    subject_id: str
    time: str | None = None
    present: int = Field(ge=0)
    total: int = Field(ge=0)
    faces: int = Field(default=0, ge=0)
    attention: int = Field(default=0, ge=0, le=100)
    source: Source = "live"
    present_student_ids: list[str] = []  # these students are marked Present


class SessionOut(CamelModel):
    id: str
    subject_id: str
    time: str
    present: int
    total: int
    faces: int
    attention: int
    source: str


# ---- Flagged verification ----
class FlagOut(CamelModel):
    id: int
    subject_id: str
    student_id: str
    score: int
    reason: str


class FlagResolve(CamelModel):
    approved: bool


# ---- Behaviour ----
class BehaviorTotals(CamelModel):
    seconds: dict[BehaviorKey, float]


class EventIn(CamelModel):
    subject_id: str
    student_name: str = Field(max_length=60)
    behavior: BehaviorKey
    attentive: bool
    reason: str = Field(default="", max_length=120)
    source: Source = "live"


class EventOut(EventIn):
    id: int
    created_at: str


# ---- Whole app state (what the page loads on start-up) ----
class StateOut(CamelModel):
    subjects: list[SubjectOut]
    students: list[StudentOut]
    flagged_queue: list[FlagOut]
    sessions: list[SessionOut]
    behavior_seconds: dict[str, dict[str, float]]
