import os
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from azure.cosmos import CosmosClient, PartitionKey, exceptions
from dotenv import load_dotenv

# Load environment variables from .env if present
load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = BASE_DIR  # serve files directly from repo folder

# FastAPI app
app = FastAPI(title="Airplane Shooter Backend")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Cosmos DB setup via env vars
COSMOS_ENDPOINT = os.getenv("COSMOS_ENDPOINT")
COSMOS_KEY = os.getenv("COSMOS_KEY")
COSMOS_DB = os.getenv("COSMOS_DB", "shooter-db")
COSMOS_CONTAINER = os.getenv("COSMOS_CONTAINER", "scores")
COSMOS_PARTITION_KEY = os.getenv("COSMOS_PARTITION_KEY", "/pk")

_cosmos_client = None
_database = None
_container = None


def get_cosmos_container():
    global _cosmos_client, _database, _container
    if _container:
        return _container
    if not COSMOS_ENDPOINT or not COSMOS_KEY:
        raise RuntimeError("Cosmos configuration missing. Set COSMOS_ENDPOINT and COSMOS_KEY")

    _cosmos_client = CosmosClient(COSMOS_ENDPOINT, COSMOS_KEY)
    # Create database and container if they don't exist
    try:
        _database = _cosmos_client.create_database_if_not_exists(id=COSMOS_DB)
    except exceptions.CosmosHttpResponseError as e:
        raise RuntimeError(f"Failed to create/access database: {e}")

    try:
        _container = _database.create_container_if_not_exists(
            id=COSMOS_CONTAINER,
            partition_key=PartitionKey(path=COSMOS_PARTITION_KEY),
            offer_throughput=400,
        )
    except exceptions.CosmosHttpResponseError as e:
        raise RuntimeError(f"Failed to create/access container: {e}")
    return _container


class ScoreIn(BaseModel):
    score: int
    # optional metadata
    player: str | None = None


@app.get("/", response_class=HTMLResponse)
async def index():
    # Serve index.html
    index_path = os.path.join(BASE_DIR, "index.html")
    if not os.path.exists(index_path):
        raise HTTPException(status_code=404, detail="index.html not found")
    with open(index_path, "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())


@app.get("/assets/{path:path}")
async def get_asset(path: str):
    # Serve assets files
    asset_path = os.path.join(BASE_DIR, "assets", path)
    if not os.path.exists(asset_path):
        raise HTTPException(status_code=404, detail="Asset not found")
    return FileResponse(asset_path)


@app.get("/{path:path}")
async def get_static(path: str):
    # Serve any other static file (css/js)
    file_path = os.path.join(BASE_DIR, path)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)


@app.post("/api/score")
async def post_score(payload: ScoreIn):
    if payload.score is None or payload.score < 0:
        raise HTTPException(status_code=400, detail="Invalid score")

    container = get_cosmos_container()

    # Find current max index; if none, start at 1
    query = "SELECT VALUE MAX(c.idx) FROM c"
    items = list(container.query_items(query=query, enable_cross_partition_query=True))
    max_idx = items[0] if items and items[0] is not None else 0
    next_idx = int(max_idx) + 1

    item = {
        "id": f"score-{next_idx}",
        "idx": next_idx,
        "score": int(payload.score),
        "player": payload.player or "anonymous",
        # Partition key value; use a constant or player-based
        "pk": "scores",
    }
    try:
        container.create_item(body=item)
    except exceptions.CosmosHttpResponseError as e:
        raise HTTPException(status_code=500, detail=f"Failed to write score: {e}")

    return JSONResponse({"ok": True, "idx": next_idx})


if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    reload = os.getenv("RELOAD", "0") == "1"
    if reload:
        # When using reload, pass the module path
        import os as _os
        module_name = _os.path.splitext(_os.path.basename(__file__))[0]
        uvicorn.run(f"{module_name}:app", host=host, port=port, reload=True)
    else:
        uvicorn.run(app, host=host, port=port)

# Run via: uvicorn shooter:app --reload
