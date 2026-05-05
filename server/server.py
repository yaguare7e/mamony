"""
Mamony sync server — drop-in replacement for Firebase Realtime Database.
Implements the same REST + SSE interface that mamony/app.js expects.

Usage:
    pip install -r requirements.txt
    python server.py          # listens on 0.0.0.0:8000

Env vars:
    PORT            TCP port (default: 8000)
    MAMONY_DB       SQLite file path (default: mamony.db next to this script)
    MAMONY_STATIC   Directory to serve as the web app (default: parent dir)
"""

import asyncio
import json
import os
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Dict, List

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

# ─── Config ───────────────────────────────────────────────────────────────────

SCRIPT_DIR  = Path(__file__).parent
DB_PATH     = os.environ.get("MAMONY_DB",     str(SCRIPT_DIR / "mamony.db"))
STATIC_DIR  = os.environ.get("MAMONY_STATIC", str(SCRIPT_DIR.parent))

# sync_key → list of per-client queues
_listeners: Dict[str, List[asyncio.Queue]] = {}

# ─── Database ─────────────────────────────────────────────────────────────────

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db() -> None:
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                sync_key        TEXT PRIMARY KEY,
                transactions    TEXT NOT NULL DEFAULT '[]',
                custom_categories TEXT NOT NULL DEFAULT '{"income":[],"expense":[]}',
                last_modified   INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS inbox (
                sync_key  TEXT NOT NULL,
                inbox_id  TEXT NOT NULL,
                data      TEXT NOT NULL,
                PRIMARY KEY (sync_key, inbox_id)
            );
            CREATE TABLE IF NOT EXISTS backups (
                sync_key     TEXT NOT NULL,
                date         TEXT NOT NULL,
                data         TEXT NOT NULL,
                backed_up_at INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (sync_key, date)
            );
        """)

def ensure_user(conn: sqlite3.Connection, sync_key: str) -> sqlite3.Row:
    conn.execute("INSERT OR IGNORE INTO users (sync_key) VALUES (?)", (sync_key,))
    conn.commit()
    return conn.execute("SELECT * FROM users WHERE sync_key = ?", (sync_key,)).fetchone()

# ─── SSE broadcast ────────────────────────────────────────────────────────────

async def broadcast(sync_key: str, event_type: str, path: str, data) -> None:
    if sync_key not in _listeners:
        return
    msg = f"event: {event_type}\ndata: {json.dumps({'path': path, 'data': data})}\n\n"
    dead = []
    for i, q in enumerate(_listeners[sync_key]):
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            dead.append(i)
    for i in reversed(dead):
        _listeners[sync_key].pop(i)

# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(title="Mamony Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup() -> None:
    init_db()

# ─── Main data: GET (regular + SSE) and PATCH ─────────────────────────────────

@app.get("/mamony/{sync_key}.json")
async def get_data(sync_key: str, request: Request):
    with get_db() as conn:
        row = ensure_user(conn, sync_key)
        data = {
            "transactions":     json.loads(row["transactions"]),
            "customCategories": json.loads(row["custom_categories"]),
            "lastModified":     row["last_modified"],
        }

    if "text/event-stream" in request.headers.get("accept", ""):
        async def generator():
            q: asyncio.Queue = asyncio.Queue(maxsize=100)
            _listeners.setdefault(sync_key, []).append(q)
            try:
                yield f"event: put\ndata: {json.dumps({'path': '/', 'data': data})}\n\n"
                while True:
                    try:
                        msg = await asyncio.wait_for(q.get(), timeout=25.0)
                        yield msg
                    except asyncio.TimeoutError:
                        yield "event: keep-alive\ndata: null\n\n"
            except asyncio.CancelledError:
                pass
            finally:
                try:
                    _listeners.get(sync_key, []).remove(q)
                except ValueError:
                    pass

        return StreamingResponse(
            generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return data


@app.patch("/mamony/{sync_key}.json")
async def patch_data(sync_key: str, request: Request):
    body = await request.json()
    with get_db() as conn:
        ensure_user(conn, sync_key)
        fields, values = [], []
        if "transactions" in body:
            fields.append("transactions = ?")
            values.append(json.dumps(body["transactions"]))
        if "customCategories" in body:
            fields.append("custom_categories = ?")
            values.append(json.dumps(body["customCategories"]))
        if "lastModified" in body:
            fields.append("last_modified = ?")
            values.append(int(body["lastModified"]))
        if fields:
            conn.execute(
                f"UPDATE users SET {', '.join(fields)} WHERE sync_key = ?",
                (*values, sync_key),
            )
    await broadcast(sync_key, "patch", "/", body)
    return body

# ─── Transactions shallow check ───────────────────────────────────────────────

@app.get("/mamony/{sync_key}/transactions.json")
async def get_transactions(sync_key: str, shallow: str = None):
    with get_db() as conn:
        row = conn.execute(
            "SELECT transactions FROM users WHERE sync_key = ?", (sync_key,)
        ).fetchone()
    if not row:
        return Response(content="null", media_type="application/json")
    txns = json.loads(row["transactions"])
    if shallow == "true":
        return True if txns else Response(content="null", media_type="application/json")
    return txns

# ─── Inbox ────────────────────────────────────────────────────────────────────

@app.get("/mamony/{sync_key}/inbox.json")
async def get_inbox(sync_key: str):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT inbox_id, data FROM inbox WHERE sync_key = ?", (sync_key,)
        ).fetchall()
    if not rows:
        return Response(content="null", media_type="application/json")
    return {r["inbox_id"]: json.loads(r["data"]) for r in rows}


@app.post("/mamony/{sync_key}/inbox.json")
async def post_inbox(sync_key: str, request: Request):
    """Apple Pay Shortcut POSTs here to add a transaction to the inbox."""
    body = await request.json()
    inbox_id = uuid.uuid4().hex[:20]
    with get_db() as conn:
        conn.execute(
            "INSERT INTO inbox (sync_key, inbox_id, data) VALUES (?, ?, ?)",
            (sync_key, inbox_id, json.dumps(body)),
        )
    await broadcast(sync_key, "patch", f"/inbox/{inbox_id}", body)
    return {"name": inbox_id}


@app.patch("/mamony/{sync_key}/inbox.json")
async def patch_inbox(sync_key: str, request: Request):
    """null value = delete the item; any other value = upsert."""
    body = await request.json()
    with get_db() as conn:
        for inbox_id, value in body.items():
            if value is None:
                conn.execute(
                    "DELETE FROM inbox WHERE sync_key = ? AND inbox_id = ?",
                    (sync_key, inbox_id),
                )
            else:
                conn.execute(
                    "INSERT INTO inbox (sync_key, inbox_id, data) VALUES (?, ?, ?) "
                    "ON CONFLICT(sync_key, inbox_id) DO UPDATE SET data = excluded.data",
                    (sync_key, inbox_id, json.dumps(value)),
                )
    await broadcast(sync_key, "patch", "/inbox", body)
    return body

# ─── Backups ──────────────────────────────────────────────────────────────────

@app.put("/mamony/{sync_key}/backups/{date}.json")
async def put_backup(sync_key: str, date: str, request: Request):
    body = await request.json()
    backed_up_at = body.get("backedUpAt", int(time.time() * 1000))
    with get_db() as conn:
        conn.execute(
            "INSERT INTO backups (sync_key, date, data, backed_up_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(sync_key, date) DO UPDATE SET data = excluded.data, backed_up_at = excluded.backed_up_at",
            (sync_key, date, json.dumps(body), backed_up_at),
        )
    return body


@app.get("/mamony/{sync_key}/backups.json")
async def get_backups(sync_key: str, shallow: str = None):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT date, data FROM backups WHERE sync_key = ?", (sync_key,)
        ).fetchall()
    if not rows:
        return Response(content="null", media_type="application/json")
    if shallow == "true":
        return {r["date"]: True for r in rows}
    return {r["date"]: json.loads(r["data"]) for r in rows}


@app.delete("/mamony/{sync_key}/backups/{date}.json")
async def delete_backup(sync_key: str, date: str):
    with get_db() as conn:
        conn.execute(
            "DELETE FROM backups WHERE sync_key = ? AND date = ?", (sync_key, date)
        )
    return Response(content="null", media_type="application/json")

# ─── Static files (serve mamony web app) ─────────────────────────────────────

if os.path.isdir(STATIC_DIR):
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")

# ─── Entrypoint ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    print(f"Mamony server starting on http://0.0.0.0:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
