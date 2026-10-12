"""API tests. Run from Sb1/backend with:  python -m pytest"""
import os
import tempfile

# Use a throwaway database so tests never touch classsight.db.
os.environ["CLASSSIGHT_DATABASE_URL"] = "sqlite:///" + os.path.join(tempfile.mkdtemp(), "test.db").replace("\\", "/")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    with TestClient(app) as c:
        c.post("/api/reset")
        yield c


def test_health_and_frontend(client):
    assert client.get("/api/health").json()["status"] == "ok"
    home = client.get("/", follow_redirects=False)
    assert home.status_code in (302, 307) and home.headers["location"] == "/INDEX.HTML"
    assert "ClassSight" in client.get("/INDEX.HTML").text


def test_state_has_demo_data_in_frontend_shape(client):
    state = client.get("/api/state").json()
    assert len(state["subjects"]) == 3
    assert len(state["students"]) == 8
    assert state["students"][0]["subjectId"] == "sub-1"
    assert "attendanceRate" in state["students"][0]
    assert {f["studentId"] for f in state["flaggedQueue"]} == {"std-5", "std-6"}
    assert len(state["sessions"]) == 2


def test_subject_lifecycle_cascades(client):
    r = client.post("/api/subjects", json={"id": "sub-x", "code": "AI-500", "name": "Applied AI"})
    assert r.status_code == 201
    assert client.post("/api/subjects", json={"code": "ai-500", "name": "Dup"}).status_code == 409
    client.post("/api/students", json={"id": "std-x", "subjectId": "sub-x", "name": "Test", "roll": "R1"})
    client.post("/api/sessions", json={"subjectId": "sub-x", "present": 1, "total": 1})
    assert client.delete("/api/subjects/sub-x").status_code == 204
    state = client.get("/api/state").json()
    assert not any(s["subjectId"] == "sub-x" for s in state["students"] + state["sessions"])


def test_students_validation_and_duplicates(client):
    body = {"subjectId": "sub-1", "name": "New Student", "roll": "CS2026-099"}
    assert client.post("/api/students", json=body).status_code == 201
    assert client.post("/api/students", json=body).status_code == 409
    assert client.post("/api/students", json={**body, "subjectId": "nope", "roll": "Z"}).status_code == 404
    assert client.post("/api/students", json={**body, "roll": "Y", "status": "Sleeping"}).status_code == 422


def test_session_marks_students_present(client):
    r = client.post("/api/sessions", json={
        "subjectId": "sub-1", "present": 5, "total": 8, "faces": 1, "attention": 77,
        "source": "live", "presentStudentIds": ["std-7"],
    })
    assert r.status_code == 201 and r.json()["attention"] == 77
    students = {s["id"]: s for s in client.get("/api/students?subject_id=sub-1").json()}
    assert students["std-7"]["status"] == "Present"


def test_flag_resolution(client):
    flags = client.get("/api/flags?subject_id=sub-1").json()
    reject = next(f for f in flags if f["studentId"] == "std-6")
    assert client.post(f"/api/flags/{reject['id']}/resolve", json={"approved": False}).status_code == 200
    assert client.post(f"/api/flags/{reject['id']}/resolve", json={"approved": False}).status_code == 404
    assert client.post("/api/subjects/sub-1/flags/approve-all").json() == {"approved": 1}
    students = {s["id"]: s["status"] for s in client.get("/api/students").json()}
    assert students["std-6"] == "Absent" and students["std-5"] == "Present"
    assert client.get("/api/flags").json() == []


def test_behavior_totals_and_events(client):
    r = client.put("/api/subjects/sub-1/behavior", json={"seconds": {"attentive": 12.5, "phone": 3}})
    assert r.json() == {"attentive": 12.5, "phone": 3.0}
    client.put("/api/subjects/sub-1/behavior", json={"seconds": {"attentive": 20}})
    assert client.get("/api/state").json()["behaviorSeconds"]["sub-1"]["attentive"] == 20
    assert client.put("/api/subjects/sub-1/behavior", json={"seconds": {"dancing": 1}}).status_code == 422

    event = {"subjectId": "sub-1", "studentName": "Ananya Sharma", "behavior": "phone",
             "attentive": False, "reason": "phone detected (81%)"}
    assert client.post("/api/events", json=event).status_code == 201
    events = client.get("/api/subjects/sub-1/events").json()
    assert events[0]["behavior"] == "phone" and events[0]["createdAt"]


def test_csv_report(client):
    r = client.get("/api/subjects/sub-1/report.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "Ananya Sharma" in r.text and "Session time (UTC)" in r.text
