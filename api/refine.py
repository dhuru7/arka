"""Vercel Serverless Function for /api/refine"""
from http.server import BaseHTTPRequestHandler
import json
import requests
import re
import time

# ── Sarvam M API Configuration ──────────────────────────────────────────────
SARVAM_API_KEY = "sk_h10vkdry_WChEvgrtvbYb4iQPe1hNVmWT"
SARVAM_API_URL = "https://api.sarvam.ai/v1/chat/completions"

MERMAID_SYSTEM_PROMPTS = {
    'flowchart': """You are a Mermaid flowchart code generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences. Do NOT add text outside Mermaid code. Do NOT use backslashes in labels.""",
    'block': """You are a Mermaid block diagram code generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences. Use graph LR or graph TD with subgraphs.""",
    'architecture': """You are a Mermaid architecture diagram code generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences.""",
    'sequence': """You are a Mermaid sequence diagram generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences.""",
    'timeline': """You are a Mermaid timeline generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences. Do NOT use parentheses in event descriptions.""",
    'gantt': """You are a Mermaid Gantt chart generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences. Do NOT use backslashes or parentheses in task names. Include dateFormat YYYY-MM-DD.""",
    'pie': """You are a Mermaid pie chart generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences. Labels must be in double quotes.""",
    'xy': """You are a Mermaid XY/Bar chart generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences. Start with xychart-beta.""",
    'er': """You are a Mermaid ER diagram generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences.""",
    'state': """You are a Mermaid state diagram generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences.""",
    'class': """You are a Mermaid class diagram generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences.""",
    'git': """You are a Mermaid gitgraph generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences. Use 'commit id:' not 'commit msg:'. Branch names must be single words.""",
    'quadrant': """You are a Mermaid quadrant chart generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences.""",
    'treemap': """You are a Mermaid mindmap generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences. Do NOT use parentheses in node names."""
}

MERMAID_KEYWORDS = [
    'graph ', 'graph\n', 'flowchart ', 'flowchart\n',
    'sequenceDiagram', 'classDiagram', 'stateDiagram',
    'erDiagram', 'gantt', 'pie', 'gitGraph',
    'mindmap', 'timeline', 'quadrantChart',
    'xychart-beta', 'architecture-beta',
    'block-beta', 'journey', 'C4Context',
    'graph TD', 'graph LR', 'graph TB', 'graph RL', 'graph BT',
    'flowchart TD', 'flowchart LR', 'flowchart TB', 'flowchart RL',
]


def clean_mermaid_code(code, mode='flowchart'):
    if not code:
        return code
    code = re.sub(r'```(?:mermaid|json|text)?\s*\n?', '', code).strip()
    lines = code.split('\n')
    start_idx = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        for kw in MERMAID_KEYWORDS:
            if stripped.startswith(kw.strip()):
                start_idx = i
                break
        else:
            continue
        break
    if start_idx > 0:
        lines = lines[start_idx:]
    cleaned = '\n'.join(lines).strip()
    # Universal fixes
    cleaned = cleaned.replace('\\n', ' ').replace('\\t', ' ')
    cleaned = re.sub(r'\\(?!["\\nrt])', '', cleaned)
    return cleaned


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)

            current_code = data.get('current_code', '')
            instruction = data.get('instruction', '')
            mode = data.get('mode', 'flowchart')

            if not instruction.strip():
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Please provide a refinement instruction.'}).encode())
                return

            system_prompt = MERMAID_SYSTEM_PROMPTS.get(mode, MERMAID_SYSTEM_PROMPTS['flowchart'])
            headers = {
                'Content-Type': 'application/json',
                'api-subscription-key': SARVAM_API_KEY
            }
            payload = {
                'model': 'sarvam-m',
                'messages': [
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': f"Here is my current {mode} diagram code:\n{current_code}\n\nPlease modify it with this instruction: {instruction}\n\nOutput ONLY the complete updated Mermaid JS code."}
                ],
                'temperature': 0.3,
                'max_tokens': 2048
            }

            response = requests.post(SARVAM_API_URL, headers=headers, json=payload, timeout=60)

            if response.status_code != 200:
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': f'AI service returned status {response.status_code}'}).encode())
                return

            result = response.json()
            bridge_code = result['choices'][0]['message']['content'].strip()
            bridge_code = clean_mermaid_code(bridge_code, mode)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                'success': True,
                'code': bridge_code,
                'usage': result.get('usage', {})
            }).encode())

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': f'Server error: {str(e)}'}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
