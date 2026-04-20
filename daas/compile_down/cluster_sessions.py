"""Session clustering — group similar agent traces into corpora.

Given N real traces, this module decides which ones describe *the
same kind of work*. The output is a list of clusters; downstream
``playbook_induction.py`` runs per-cluster to find the shared
playbook.

Similarity is a linear combination of two cheap deterministic
signals — no LLM, no embedding API:

    sim(a, b) = 0.55 * jaccard(shingles(tool_class_sequence))
              + 0.45 * cosine(tfidf(first_user_message_text))

Tool-class shingling preserves ORDERED pattern (search->read->edit
clusters differently from read->edit->search). TF-IDF on the first
user message captures topic / intent. The 0.55 / 0.45 weighting
biases slightly toward tool-sequence because tool pattern is a
better signal of "same kind of work" than topic word overlap.

Clustering algorithm:
    Agglomerative single-linkage with a threshold on similarity.
    We pick single-linkage rather than average/complete because
    chains of related sessions (A~B~C where A<>C directly) are a
    real pattern — a long diligence thread, for example.

No dependencies beyond stdlib. Runs on the JSONL corpus in place.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any

from daas.compile_down.normalizers.claude_code import from_claude_code_jsonl
from daas.compile_down.meta_workflow import _tool_class  # reuse classifier


# --------- feature extraction --------------------------------------------
def tool_class_sequence(trace) -> list[str]:
    seq: list[str] = []
    last = None
    for step in trace.steps:
        for call in step.tool_calls or []:
            klass = _tool_class(call.name)
            if klass and klass != last:
                seq.append(klass)
                last = klass
    return seq


def shingles(seq: list[str], k: int = 3) -> set[tuple[str, ...]]:
    """k-grams over the tool-class sequence."""
    if len(seq) < k:
        return {tuple(seq)} if seq else set()
    return {tuple(seq[i : i + k]) for i in range(len(seq) - k + 1)}


def jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


_WORD_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9_'-]{2,}")
_STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "have", "has",
    "are", "was", "will", "can", "you", "your", "our", "but", "not",
    "all", "any", "get", "got", "let", "lets", "use", "using", "used",
    "make", "made", "also", "now", "one", "two", "into", "out", "its",
    "been", "being", "what", "when", "where", "how", "why", "who",
    "just", "very", "really", "there", "their", "they", "them", "then",
    "about", "above", "below", "over", "under", "like", "some", "more",
    "most", "other", "which", "should", "would", "could", "may", "might",
    "must", "each", "every", "need", "needs", "needed", "want", "wants",
    "dont", "doesnt", "didnt", "cant", "couldnt", "wasnt", "werent",
    "ive", "youve", "weve", "theyve", "its", "thats", "heres", "theres",
    "please", "though", "through", "while", "still", "much", "many",
    "here", "still", "ever", "never", "sometimes", "often",
}


def tokenize(text: str) -> list[str]:
    return [
        t.lower()
        for t in _WORD_RE.findall(text or "")
        if t.lower() not in _STOPWORDS and len(t) > 2
    ]


def tfidf_vectors(docs: list[list[str]]) -> list[dict[str, float]]:
    # Document frequency
    df: dict[str, int] = {}
    for d in docs:
        for w in set(d):
            df[w] = df.get(w, 0) + 1
    n = max(1, len(docs))
    vectors: list[dict[str, float]] = []
    for d in docs:
        tf: dict[str, int] = {}
        for w in d:
            tf[w] = tf.get(w, 0) + 1
        total = max(1, sum(tf.values()))
        vec: dict[str, float] = {}
        for w, c in tf.items():
            if df.get(w, 0) == 0:
                continue
            idf = math.log((n + 1) / (df[w] + 1)) + 1.0  # smoothed
            vec[w] = (c / total) * idf
        vectors.append(vec)
    return vectors


def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    if not a or not b:
        return 0.0
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    if not na or not nb:
        return 0.0
    inter = set(a) & set(b)
    dot = sum(a[w] * b[w] for w in inter)
    return dot / (na * nb)


# --------- agglomerative single-linkage ----------------------------------
@dataclass
class SessionFeatures:
    session_id: str
    source_path: str
    file_bytes: int
    step_count: int
    tool_class_seq: list[str]
    first_user_tokens: list[str]
    label: str = ""  # short human label for the session


@dataclass
class Cluster:
    cluster_id: str
    session_ids: list[str]
    common_tool_classes: list[str]
    common_tokens: list[str]
    label: str  # human-readable cluster name


def cluster_sessions(
    features: list[SessionFeatures],
    *,
    threshold: float = 0.30,
    alpha: float = 0.55,
) -> list[Cluster]:
    """Single-linkage agglomerative clustering on a pairwise similarity
    matrix. Returns ordered clusters (largest first).

    ``threshold`` — merge if sim >= threshold (lower = bigger clusters)
    ``alpha``    — weight on shingle jaccard vs TF-IDF cosine
    """
    n = len(features)
    if n == 0:
        return []

    # Precompute shingles + TF-IDF vectors
    shings = [shingles(f.tool_class_seq) for f in features]
    tfidf_vecs = tfidf_vectors([f.first_user_tokens for f in features])

    # Union-find for disjoint-set merging
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    # Pairwise compare; single-linkage merges anytime threshold is hit
    for i in range(n):
        for j in range(i + 1, n):
            jac = jaccard(shings[i], shings[j])
            cos = cosine(tfidf_vecs[i], tfidf_vecs[j])
            sim = alpha * jac + (1.0 - alpha) * cos
            if sim >= threshold:
                union(i, j)

    # Collect clusters
    groups: dict[int, list[int]] = {}
    for i in range(n):
        r = find(i)
        groups.setdefault(r, []).append(i)

    clusters: list[Cluster] = []
    for root, members in groups.items():
        if len(members) == 0:
            continue
        # Common tool classes = intersection of tool_class sequences (set form)
        class_sets = [set(features[m].tool_class_seq) for m in members]
        common_classes = sorted(
            set.intersection(*class_sets) if class_sets else set()
        )
        # Common tokens = tokens appearing in >= ceil(len/2) members
        token_counts: dict[str, int] = {}
        for m in members:
            for w in set(features[m].first_user_tokens):
                token_counts[w] = token_counts.get(w, 0) + 1
        threshold_count = max(1, math.ceil(len(members) / 2))
        common_tokens = sorted(
            [w for w, c in token_counts.items() if c >= threshold_count]
        )[:12]
        # Label heuristic: top 3 tokens + dominant tool class
        label_tokens = common_tokens[:3]
        dom_class = (
            max(set(features[members[0]].tool_class_seq), key=features[members[0]].tool_class_seq.count)
            if features[members[0]].tool_class_seq
            else ""
        )
        label = ("/".join(label_tokens) or dom_class or "cluster").strip()
        clusters.append(
            Cluster(
                cluster_id=f"cluster_{len(clusters)}",
                session_ids=[features[m].session_id for m in members],
                common_tool_classes=common_classes,
                common_tokens=common_tokens,
                label=label[:80],
            )
        )

    # Sort largest-first
    clusters.sort(key=lambda c: -len(c.session_ids))
    # Reassign cluster_ids in sorted order
    for i, c in enumerate(clusters):
        c.cluster_id = f"cluster_{i}"
    return clusters


def extract_features(jsonl_path: Path) -> SessionFeatures:
    trace = from_claude_code_jsonl(jsonl_path)
    seq = tool_class_sequence(trace)
    first_user = trace.query or ""
    tokens = tokenize(first_user)
    label = (first_user[:80].replace("\n", " ")).strip() or jsonl_path.stem[:8]
    return SessionFeatures(
        session_id=jsonl_path.stem,
        source_path=str(jsonl_path),
        file_bytes=jsonl_path.stat().st_size,
        step_count=len(trace.steps),
        tool_class_seq=seq,
        first_user_tokens=tokens,
        label=label,
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--projects-root", default=str(Path.home() / ".claude" / "projects")
    )
    ap.add_argument(
        "--project",
        default="D--VSCode-Projects-cafecorner-nodebench-nodebench-ai4-nodebench-ai",
    )
    ap.add_argument("--sessions", nargs="+", required=True)
    ap.add_argument("--threshold", type=float, default=0.30)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    project_dir = Path(args.projects_root) / args.project
    if not project_dir.exists():
        print(f"[ERR] project dir missing: {project_dir}", file=sys.stderr)
        return 2

    features: list[SessionFeatures] = []
    for sid in args.sessions:
        p = project_dir / f"{sid}.jsonl"
        if not p.exists():
            print(f"[WARN] missing {sid}")
            continue
        f = extract_features(p)
        features.append(f)
        print(
            f"[feat] {sid[:8]}  "
            f"seq_len={len(f.tool_class_seq):>3}  "
            f"tokens={len(f.first_user_tokens):>3}  "
            f"label={f.label[:60]!r}"
        )

    clusters = cluster_sessions(features, threshold=args.threshold)
    print("\n=== CLUSTERS ===")
    for c in clusters:
        print(
            f"  {c.cluster_id}  n={len(c.session_ids)}  "
            f"label={c.label[:50]!r}  "
            f"classes={','.join(c.common_tool_classes)}"
        )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "threshold": args.threshold,
                "session_count": len(features),
                "cluster_count": len(clusters),
                "clusters": [asdict(c) for c in clusters],
                "features": [asdict(f) for f in features],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\n[DONE] wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
