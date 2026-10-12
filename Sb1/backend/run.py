"""Start the ClassSight server:  python run.py   then open http://localhost:8000"""
import uvicorn

if __name__ == "__main__":
    print("ClassSight running at http://localhost:8000  (API docs: http://localhost:8000/docs)")
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
