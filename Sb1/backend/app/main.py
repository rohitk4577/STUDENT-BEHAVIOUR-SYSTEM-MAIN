"""
ClassSight backend.

Serves the website (Sb1/FRONTEND) and a REST API that stores subjects,
students, attendance sessions and behaviour data in SQLite.

Run from the Sb1/backend folder:
    python run.py
then open http://localhost:8000   (API docs: http://localhost:8000/docs)
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.config import APP_NAME, FRONTEND_DIR
from app.database import Base, SessionLocal, engine
from app.routers import attendance, behavior, students, subjects, system
from app.seed import seed_if_empty


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)  # creates classsight.db on first run
    with SessionLocal() as db:
        seed_if_empty(db)
    yield


app = FastAPI(
    title=APP_NAME,
    description="Attendance and classroom-behaviour records for the ClassSight web app.",
    version="1.0.0",
    lifespan=lifespan,
)

# Lets the page call the API even if it is opened from another local server/port.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

for module in (system, subjects, students, attendance, behavior):
    app.include_router(module.router)


@app.get("/", include_in_schema=False)
def home():
    return RedirectResponse("/INDEX.HTML")


# Must come last: anything that is not an API route is served from the FRONTEND folder.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
