# ---- Stage 1: build the React frontend ----
FROM node:22-alpine AS frontend
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: Python backend that also serves the built frontend ----
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 EMBED_CACHE_DIR=/app/models

COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

# Download the small embedding model at build time so startup is fast.
# If this fails, the app still works using BM25 keyword search.
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5', cache_dir='/app/models')" || echo "embedding model not cached"

COPY backend/ backend/
COPY knowledge_base/ knowledge_base/
COPY prompts/ prompts/
COPY --from=frontend /fe/dist frontend/dist

EXPOSE 10000
CMD ["sh", "-c", "uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port ${PORT:-10000}"]
