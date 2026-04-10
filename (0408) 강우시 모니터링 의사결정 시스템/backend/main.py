import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from datetime import datetime, timezone, timedelta
import time
import math

app = FastAPI(title="Rain-Pollution Deployment Decision Support System")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 프론트엔드 정적 파일 서빙 (안드로이드 앱 화면용)
app.mount("/", StaticFiles(directory="../frontend", html=True), name="static")

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "message": "Backend is running just to serve local frontend files."}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000)
