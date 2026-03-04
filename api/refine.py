"""Vercel Serverless Function for /api/refine"""
from http.server import BaseHTTPRequestHandler
import json
import requests
import re
import time
import os

# ── Sarvam M API Configuration ──────────────────────────────────────────────
SARVAM_API_KEY = os.getenv("SARVAM_API_KEY", "").strip('"\' ')
SARVAM_API_URL = "https://api.sarvam.ai/v1/chat/completions"

MERMAID_SYSTEM_PROMPTS = {
    'flowchart': """You are an expert Mermaid flowchart code generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences. SUBGRAPHS MUST be closed with the exact word 'end' on a new line. NEVER use 'end subgraph'. Do NOT use parentheses inside labels.""",
    'block': """You are an expert Mermaid block diagram code generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences. Use graph LR or graph TD. SUBGRAPHS MUST be closed with the exact word 'end' on a new line. NEVER use 'end subgraph'. Do NOT use parentheses inside labels.""",
    'architecture': """You are an expert Mermaid architecture diagram code generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences. SUBGRAPHS MUST be closed with the exact word 'end' on a new line. NEVER use 'end subgraph'. Do NOT use parentheses inside labels.""",
    'sequence': """You are a Mermaid sequence diagram generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences.""",
    'timeline': """You are a Mermaid timeline generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences. Do NOT use parentheses in event descriptions.""",
    'gantt': """You are a Mermaid Gantt chart generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences. Do NOT use backslashes or parentheses in task names. Task names MUST be SHORT — maximum 3-4 words. Include dateFormat YYYY-MM-DD.""",
    'pie': """You are a Mermaid pie chart generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences. Labels must be in double quotes.""",
    'xy': """You are a Mermaid XY/Bar chart generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences. Start with xychart-beta. Use x-axis with bracket notation for labels. Use bar or line for data series.""",
    'er': """You are a Mermaid ER diagram generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences.""",
    'state': """You are a Mermaid state diagram generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences.""",
    'class': """You are a Mermaid class diagram generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences.""",
    'git': """You are a Mermaid gitgraph generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences. Start with 'gitGraph' (exact casing). Use ONLY: commit, branch, checkout, merge. Use 'commit id:' NOT 'commit msg:'. Commit IDs MUST be in double quotes. Branch names must be single words. Do NOT use tag: or cherry-pick commands.""",
    'quadrant': """You are an expert Mermaid quadrant chart generator. You ONLY output valid Mermaid JS code. Do NOT use markdown code fences. NEVER use parentheses () or brackets [] in axis labels or point names. Axis labels MUST strictly be: 'x-axis Left Label --> Right Label'.""",
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
    
    if mode in ('flowchart', 'block', 'architecture'):
        cleaned = re.sub(r'(?<![\[\]\|])\((?![\[\]\|])', ' ', cleaned)
        cleaned = re.sub(r'(?<![\[\]\|])\)(?![\[\]\|])', ' ', cleaned)

    if mode == 'gantt':
        cleaned = _fix_gantt(cleaned)
    elif mode == 'timeline':
        cleaned = _fix_timeline(cleaned)
    elif mode == 'git':
        cleaned = _fix_gitgraph(cleaned)
    elif mode == 'pie':
        cleaned = _fix_pie(cleaned)
    elif mode == 'treemap':
        cleaned = _fix_mindmap(cleaned)
    elif mode == 'xy':
        cleaned = _fix_xychart(cleaned)

    return cleaned


def _fix_gantt(code):
    lines = code.split('\n')
    fixed = []
    has_date_format = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('dateFormat'):
            has_date_format = True
            line = '    dateFormat YYYY-MM-DD'
            fixed.append(line)
            continue
        if stripped.startswith('axisFormat'):
            line = line.replace(':', '')
            fixed.append(line)
            continue
        if stripped.startswith('section '):
            stripped = re.sub(r'[()\\\\]', '', stripped)
            section_name = stripped[8:].strip()
            if len(section_name) > 30:
                section_name = ' '.join(section_name.split()[:4])
            line = '    section ' + section_name
        elif ':' in stripped and not stripped.startswith(('section', 'dateFormat', 'title', 'gantt', 'axisFormat', 'todayMarker', 'tickInterval', 'excludes', 'includes')):
            parts = stripped.split(':', 1)
            task_name = re.sub(r'[()\\\\]', '', parts[0]).strip()
            words = task_name.split()
            if len(words) > 4:
                task_name = ' '.join(words[:4])
            elif len(task_name) > 25:
                task_name = task_name[:25].rstrip()
            task_meta = parts[1].strip() if len(parts) > 1 else ''
            if not task_meta:
                task_meta = '2024-01-01, 30d'
            line = '        ' + task_name + ' :' + task_meta
        fixed.append(line)
    result = '\n'.join(fixed)
    if not has_date_format:
        result = result.replace('gantt', 'gantt\n    dateFormat YYYY-MM-DD', 1)
    return result


def _fix_timeline(code):
    lines = code.split('\n')
    fixed = []
    for line in lines:
        stripped = line.strip()
        if ':' in stripped and not stripped.startswith(('title', 'timeline', 'section')):
            line = re.sub(r'[()\\\\]', '', line)
        if stripped.startswith('section '):
            line = re.sub(r'[()\\\\]', '', line)
        fixed.append(line)
    return '\n'.join(fixed)


def _fix_gitgraph(code):
    lines = code.split('\n')
    fixed = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.lower() == 'gitgraph':
            line = 'gitGraph'
            fixed.append(line)
            continue
        if 'commit msg:' in stripped:
            line = line.replace('commit msg:', 'commit id:')
            stripped = line.strip()
        if stripped.startswith('tag:') or ' tag:' in stripped:
            line = re.sub(r'\s*tag:\s*"[^"]*"', '', line)
            stripped = line.strip()
        if stripped.startswith('cherry-pick'):
            continue
        if 'commit' in stripped and 'id:' in stripped:
            line = re.sub(r'[()\\\\]', '', line)
            match = re.search(r'commit\s+id:\s*(["\']?)(.+?)\1\s*$', line.strip())
            if match:
                quote = match.group(1)
                msg = match.group(2).strip()
                if not quote:
                    line = '    commit id: "' + msg + '"'
        elif stripped.startswith('commit') and 'id:' not in stripped and stripped != 'commit':
            rest = stripped[6:].strip()
            if rest and rest != ':':
                line = '    commit id: "' + re.sub(r'[()\\\\"\']', '', rest) + '"'
            else:
                line = '    commit'
        elif stripped == 'commit':
            line = '    commit'
        if stripped.startswith('branch '):
            branch_name = stripped[7:].strip().strip('"').strip("'")
            branch_name = re.sub(r'[^a-zA-Z0-9_/-]', '-', branch_name)
            branch_name = branch_name.strip('-')
            if not branch_name:
                branch_name = 'feature'
            line = '    branch ' + branch_name
        if stripped.startswith('checkout '):
            branch_name = stripped[9:].strip().strip('"').strip("'")
            branch_name = re.sub(r'[^a-zA-Z0-9_/-]', '-', branch_name)
            branch_name = branch_name.strip('-')
            if not branch_name:
                branch_name = 'main'
            line = '    checkout ' + branch_name
        if stripped.startswith('merge '):
            branch_name = stripped[6:].strip().strip('"').strip("'")
            branch_name = re.sub(r'[^a-zA-Z0-9_/-]', '-', branch_name)
            branch_name = branch_name.strip('-')
            if not branch_name:
                continue
            line = '    merge ' + branch_name
        fixed.append(line)
    return '\n'.join(fixed)


def _fix_pie(code):
    lines = code.split('\n')
    fixed = []
    for line in lines:
        stripped = line.strip()
        if ':' in stripped and not stripped.startswith(('title', 'pie')):
            parts = stripped.split(':', 1)
            label = parts[0].strip().strip('"').strip("'")
            value = parts[1].strip()
            line = '    "' + label + '" : ' + value
        fixed.append(line)
    return '\n'.join(fixed)


def _fix_mindmap(code):
    lines = code.split('\n')
    fixed = []
    for line in lines:
        if not line.strip().startswith('mindmap'):
            line = re.sub(r'\\\\', '', line)
        fixed.append(line)
    return '\n'.join(fixed)


def _fix_xychart(code):
    lines = code.split('\n')
    fixed = []
    for line in lines:
        stripped = line.strip()
        if stripped.lower().startswith('xychart'):
            line = 'xychart-beta'
            fixed.append(line)
            continue
        if stripped.startswith('x-axis') or stripped.startswith('y-axis'):
            line = re.sub(r'[()\\\\]', '', line)
        if stripped.startswith('bar ') or stripped.startswith('line '):
            line = re.sub(r'[()\\\\]', '', line)
        fixed.append(line)
    return '\n'.join(fixed)


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

