"""RAG: retrieve the most relevant knowledge-base sections for a query.

1. Load every .md file in knowledge_base/ (except README.md).
2. Split each file into chunks at '## ' headings (each section stands on its own).
3. Index the chunks:
   - vector: embed with a small ONNX model (fastembed, bge-small) and use cosine similarity
   - bm25:   classic keyword ranking, zero dependencies (fallback / low-memory hosts)
4. search(query) returns the top-k chunks, which the agent reads before answering.

The agent always writes the search query in English, so Hindi callers still match English docs.
"""
import logging
import math
import re
from collections import Counter

from . import config

log = logging.getLogger(__name__)
TOKEN_RE = re.compile(r"[a-z0-9]+")
STOPWORDS = set("a an the is are was of to in on for and or with what how much do does i my me we you your it be can this that at by from as".split())


def _tokens(text: str) -> list:
    return [t for t in TOKEN_RE.findall(text.lower()) if t not in STOPWORDS]


def load_chunks() -> list:
    chunks = []
    for path in sorted(config.KB_DIR.glob("*.md")):
        if path.name.lower() == "readme.md":
            continue
        text = path.read_text(encoding="utf-8")
        doc_title = text.splitlines()[0].lstrip("# ").strip()
        for part in re.split(r"\n(?=## )", text):
            lines = part.strip().splitlines()
            if not lines or not lines[0].startswith("## "):
                continue  # skip the document title block
            section = lines[0][3:].strip()
            body = "\n".join(lines[1:]).strip()
            chunks.append({"id": f"{path.stem}#{len(chunks)}", "source": path.name,
                           "title": f"{doc_title} > {section}", "text": body})
    return chunks


class BM25:
    def __init__(self, docs: list, k1: float = 1.5, b: float = 0.75):
        self.docs = [_tokens(d) for d in docs]
        self.k1, self.b = k1, b
        self.avgdl = sum(len(d) for d in self.docs) / max(len(self.docs), 1)
        df = Counter(t for d in self.docs for t in set(d))
        n = len(self.docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}
        self.tf = [Counter(d) for d in self.docs]

    def scores(self, query: str) -> list:
        q = _tokens(query)
        out = []
        for tf, doc in zip(self.tf, self.docs):
            s = 0.0
            for t in q:
                if t in tf:
                    f = tf[t]
                    s += self.idf[t] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * len(doc) / self.avgdl))
            out.append(s)
        return out


class KnowledgeBase:
    def __init__(self):
        self.chunks = load_chunks()
        texts = [f"{c['title']}\n{c['text']}" for c in self.chunks]
        self.bm25 = BM25(texts)
        self.backend = "bm25"
        self.embedder, self.matrix = None, None
        if config.RAG_BACKEND in ("auto", "vector"):
            try:
                import numpy as np
                from fastembed import TextEmbedding

                self.embedder = TextEmbedding(config.EMBED_MODEL, cache_dir=config.EMBED_CACHE_DIR)
                vecs = np.array(list(self.embedder.embed(texts)))
                self.matrix = vecs / np.linalg.norm(vecs, axis=1, keepdims=True)
                self.backend = "vector"
            except Exception as exc:  # noqa: BLE001
                log.warning("Vector RAG unavailable (%s). Using BM25.", exc)
        log.info("RAG ready: %d chunks, backend=%s", len(self.chunks), self.backend)

    def search(self, query: str, k: int = 3) -> list:
        if self.backend == "vector":
            import numpy as np

            q = np.array(list(self.embedder.query_embed(query)))[0]
            q = q / np.linalg.norm(q)
            sims = self.matrix @ q
            # Blend in keyword scores so exact terms (e.g. "AMC", "Jammu") still win.
            kw = np.array(self.bm25.scores(query))
            if kw.max() > 0:
                sims = sims + 0.15 * kw / kw.max()
            ranked = sims.argsort()[::-1][:k]
        else:
            scores = self.bm25.scores(query)
            ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:k]
        return [self.chunks[i] for i in ranked]


_kb = None


def kb() -> KnowledgeBase:
    global _kb
    if _kb is None:
        _kb = KnowledgeBase()
    return _kb
