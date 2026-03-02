"""Vercel Serverless Function for /api/yt-notes"""
from http.server import BaseHTTPRequestHandler
import concurrent.futures
import json
import os
import re
import time

import requests


SARVAM_API_KEY = os.getenv("SARVAM_API_KEY", "").strip('"\' ')
SARVAM_API_URL = "https://api.sarvam.ai/v1/chat/completions"


def extract_video_id(url: str):
    match = re.search(r"(?:v=|\/)([0-9A-Za-z_-]{11}).*", url or "")
    return match.group(1) if match else None


def chunk_text(text: str, max_length: int = 1400):
    if not text:
        return []
    num_parts = (len(text) // max_length) + 1
    target_length = len(text) // num_parts
    words = text.split()
    chunks = []
    current_chunk = []
    current_length = 0
    for word in words:
        if current_length + len(word) + 1 > target_length and len(chunks) < num_parts - 1:
            chunks.append(" ".join(current_chunk))
            current_chunk = [word]
            current_length = len(word)
        else:
            current_chunk.append(word)
            current_length += len(word) + 1
    if current_chunk:
        chunks.append(" ".join(current_chunk))
    return chunks


def fetch_transcript_from_supadata(video_id: str):
    supadata_key = "sd_14a060fc8a6b311244d92b1661d00fe5"
    url = f"https://api.supadata.ai/v1/transcript?url=https://www.youtube.com/watch?v={video_id}&text=true"
    headers = {"x-api-key": supadata_key}
    
    response = requests.get(url, headers=headers, timeout=30)
    if response.status_code != 200:
        raise Exception(f"Supadata API Error {response.status_code}")
    
    data = response.json()
    if "content" in data:
        return data["content"]
    elif "text" in data:
        return data["text"]
    else:
        return str(data)

def get_sarvam_notes(chunk: str, attempt: int = 1) -> str:
    if not SARVAM_API_KEY:
        return "[Error: SARVAM_API_KEY is not set on the server]"

    headers = {
        "Content-Type": "application/json",
        "api-subscription-key": SARVAM_API_KEY,
    }
    system_prompt = (
        "You are an expert AI that makes detailed educational notes from YouTube video transcripts. "
        "Create concise, well-structured notes for the following transcript segment. "
        "Use Markdown and use LaTeX math equations (e.g. $$...$$ or $...$) if applicable. "
        "Do not include markdown code block backticks around your whole response, just return the raw markdown text."
    )

    payload = {
        "model": "sarvam-m",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Generate detailed notes for this transcript segment: {chunk}"},
        ],
        "temperature": 0.3,
        "max_tokens": 2048,
    }

    try:
        response = requests.post(SARVAM_API_URL, headers=headers, json=payload, timeout=60)
        if response.status_code == 200:
            result = response.json()
            return result.get("choices", [{}])[0].get("message", {}).get("content", "").strip()

        if attempt < 3 and response.status_code in (429, 500, 502, 503, 504):
            time.sleep(2**attempt)
            return get_sarvam_notes(chunk, attempt + 1)

        detail = ""
        try:
            detail = response.text.strip()
        except Exception:
            detail = ""
        if detail:
            return f"[Error: Sarvam API returned {response.status_code} for a chunk. Detail: {detail[:400]}]"
        return f"[Error: Sarvam API returned {response.status_code} for a chunk]"
    except Exception as e:
        if attempt < 3:
            time.sleep(2**attempt)
            return get_sarvam_notes(chunk, attempt + 1)
        return f"[Error connecting to AI: {str(e)}]"


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            data = json.loads(body) if body else {}

            url = (data.get("url") or "").strip()
            if not url:
                self._json(400, {"error": "Please provide a YouTube URL."})
                return

            video_id = extract_video_id(url)
            if not video_id:
                self._json(400, {"error": "Invalid YouTube URL or Video ID not found."})
                return

            if not SARVAM_API_KEY:
                self._json(500, {"error": "Server is missing SARVAM_API_KEY. Set it in Vercel environment variables."})
                return

            try:
                full_transcript = fetch_transcript_from_supadata(video_id)
                if not full_transcript or len(str(full_transcript)) < 10:
                    self._json(400, {"error": "Transcript was retrieved but contained no text."})
                    return
            except Exception as e:
                self._json(400, {"error": f"Could not extract transcript: {str(e)}"})
                return

            chunks = chunk_text(full_transcript, 1400)
            if not chunks:
                self._json(400, {"error": "No transcript text to process."})
                return

            # Keep concurrency modest in serverless
            max_workers = 3 if len(chunks) > 1 else 1
            results = [None] * len(chunks)
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_to_idx = {executor.submit(get_sarvam_notes, chunk): i for i, chunk in enumerate(chunks)}
                for future in concurrent.futures.as_completed(future_to_idx):
                    i = future_to_idx[future]
                    try:
                        results[i] = future.result()
                    except Exception:
                        results[i] = f"[Error processing chunk {i + 1}]"

            notes = "\n\n---\n\n".join([r for r in results if r])
            if not notes.strip():
                self._json(502, {"error": "Failed to generate notes."})
                return

            # Convert auth failures into a clean API error for the UI
            if all(
                isinstance(r, str) and ("invalid_api_key_error" in r or "SARVAM_API_KEY" in r)
                for r in results
                if r
            ):
                self._json(502, {"error": "Sarvam authentication failed. Check SARVAM_API_KEY."})
                return

            self._json(200, {"success": True, "notes": notes})

        except Exception as e:
            self._json(500, {"error": f"Server error: {str(e)}"})

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _json(self, status: int, payload: dict):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

