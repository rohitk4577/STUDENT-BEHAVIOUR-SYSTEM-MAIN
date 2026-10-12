# ClassSight backend

A FastAPI and SQLite server that:

- **serves the website** (`Sb1/FRONTEND`) at <http://localhost:8000>
- **stores everything in a database** (`classsight.db`): subjects, students,
  attendance sessions, flagged cases, behaviour time totals and every
  behaviour label the AI produced
- provides interactive **API docs** at <http://localhost:8000/docs>

The AI itself runs in the browser (see `FRONTEND/js/vision-engine.js`). The
backend stores the results.

## Run it (Windows, from VS Code's terminal)

```powershell
cd Sb1\backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python run.py
```

Then open **http://localhost:8000** in Chrome or Edge. Press **Ctrl + C** in
the terminal to stop the server.

On later runs you only need:

```powershell
cd Sb1\backend
.venv\Scripts\activate
python run.py
```

On macOS/Linux, use `source .venv/bin/activate` instead of `.venv\Scripts\activate`.

> If PowerShell says *running scripts is disabled*, run
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use
> Command Prompt (`cmd`) instead.

The database file `classsight.db` is created automatically on the first run
and filled with demo data. To start fresh, either delete the file or use
**Subjects → Reset Demo Data** in the app.

## Folder layout

```
backend/
├── run.py                 start the server
├── requirements.txt
├── app/
│   ├── main.py            creates the FastAPI app, serves FRONTEND, includes routers
│   ├── config.py          paths and database URL (overridable by env vars)
│   ├── database.py        SQLAlchemy engine/session
│   ├── models.py          database tables
│   ├── schemas.py         request/response validation (Pydantic)
│   ├── seed.py            demo data
│   └── routers/
│       ├── system.py      /api/health, /api/state, /api/reset
│       ├── subjects.py    /api/subjects, CSV report
│       ├── students.py    /api/students
│       ├── attendance.py  /api/sessions, /api/flags
│       └── behavior.py    /api/events, behaviour totals
└── tests/test_api.py      run with: python -m pytest
```

## API summary

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Server is up |
| GET | `/api/state` | Everything the page needs on start-up |
| POST | `/api/reset` | Restore demo data |
| GET/POST | `/api/subjects` | List / create subjects |
| DELETE | `/api/subjects/{id}` | Delete a subject and all its data |
| GET | `/api/subjects/{id}/report.csv` | Roster and sessions as a CSV file (opens in Excel) |
| GET/POST | `/api/students` | List (`?subject_id=`) / enrol students |
| PATCH/DELETE | `/api/students/{id}` | Update status / remove a student |
| GET/POST | `/api/sessions` | Attendance sessions (POST marks the detected students Present) |
| GET | `/api/flags` | Open low-confidence cases |
| POST | `/api/flags/{id}/resolve` | `{"approved": true/false}` |
| POST | `/api/subjects/{id}/flags/approve-all` | Approve every open case in a subject |
| POST | `/api/events` | Log one behaviour label change |
| GET | `/api/subjects/{id}/events` | Latest behaviour events |
| GET/PUT | `/api/subjects/{id}/behavior` | Seconds spent per behaviour |

All request and response bodies are validated. For example, an unknown
behaviour or student status returns HTTP 422, and a duplicate roll number
returns 409.

## Settings (optional)

| Environment variable | Default |
|---|---|
| `CLASSSIGHT_DATABASE_URL` | `sqlite:///<backend>/classsight.db` (any SQLAlchemy URL, e.g. PostgreSQL) |
| `CLASSSIGHT_FRONTEND_DIR` | `../FRONTEND` |

## Note about `Sb1/PROJECT/BACKEND`

That older folder is replaced by this one. It imports modules that were
never written (`app.api`, `app.core`, `app.websocket`), and its upper-case
folder names stop Python's imports from working, so it cannot run. You can
delete it.
