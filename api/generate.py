"""Vercel Serverless Function for /api/generate"""
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
    'flowchart': """You are an expert Mermaid flowchart generator. You ONLY output valid, pristine Mermaid JS syntax.

CRITICAL RULES:
- NEVER use markdown blocks (no ```)
- NEVER explain, comment, or output anything except the diagram code
- ALWAYS start with 'graph TD' or 'flowchart TD'
- SUBGRAPHS MUST be closed with the exact word 'end' on a new line. NEVER use 'end subgraph' or 'END'.
- NODE IDs MUST be simple (e.g., A, B, C) without spaces or special characters.
- LABELS MUST NOT contain parentheses (), brackets [], or quotes "".
- AVOID complex nesting if possible.

Example:
flowchart TD
  A[Start Process] --> B{Check Condition}
  B -->|Yes| C[Process Request]
  B -->|No| D[Reject Request]
  C --> E[End Process]
  D --> E""",

    'block': """You are an expert Mermaid block diagram code generator. You ONLY output valid Mermaid JS code.

CRITICAL RULES:
- NEVER use markdown blocks (no ```)
- ALWAYS start with 'graph LR' or 'graph TD'
- SUBGRAPHS MUST be closed with the exact word 'end' on a new line. NEVER use 'end subgraph', 'End', or 'END'.
- LABELS MUST NOT contain parentheses () or backslashes.
- Node IDs must be simple alphanumeric strings without spaces.

Example:
graph LR
  subgraph Client
    A[Browser]
  end
  subgraph Backend Area
    B[API Gateway]
    C[Service Core]
    D[(Database)]
  end
  A -->|HTTP| B
  B --> C
  C --> D""",

    'architecture': """You are an expert Mermaid architecture diagram code generator. You ONLY output valid Mermaid JS code.

CRITICAL RULES:
- NEVER use markdown blocks (no ```)
- Use 'graph TD' or 'graph LR'
- SUBGRAPHS MUST be closed with the exact word 'end' on a new line. NEVER use 'end subgraph' or 'END'.
- Do NOT use parentheses inside node labels.

Example:
graph TD
  subgraph Cloud Infrastructure
    LB[Load Balancer]
    subgraph App Tier
      S1[Server 1]
      S2[Server 2]
    end
    DB[(Database)]
  end
  Client[Client] --> LB
  LB --> S1
  LB --> S2
  S1 --> DB
  S2 --> DB""",

    'sequence': """You are a Mermaid sequence diagram generator. You ONLY output valid Mermaid JS code.

RULES:
- Do NOT use markdown code fences
- Start with sequenceDiagram on first line

Example:
sequenceDiagram
    participant User
    participant Server
    participant DB
    User->>Server: Login Request
    Server->>DB: Query User
    DB-->>Server: User Data
    Server-->>User: Auth Token""",

    'timeline': """You are a Mermaid timeline generator. You ONLY output valid Mermaid JS code.

CRITICAL RULES:
- Do NOT use markdown code fences
- Start with 'timeline' on the first line
- The second line MUST be 'title Your Timeline Title'
- Use sections with 'section Section Name'
- Each event: Year : Event description
- Do NOT use parentheses () in event descriptions
- Keep event descriptions short

Example:
timeline
    title History of Social Media
    section Early Days
        2002 : LinkedIn launched
        2004 : Facebook launched
    section Growth Era
        2006 : Twitter launched
        2010 : Instagram launched""",

    'gantt': """You are a Mermaid Gantt chart generator. You ONLY output valid Mermaid JS code.

CRITICAL RULES:
- Do NOT use markdown code fences
- Start with 'gantt' on the first line
- Include 'dateFormat YYYY-MM-DD' on the second line
- Do NOT use backslashes or parentheses in task names
- Each task: TaskName :status, id, startDate, duration

Example:
gantt
    title Project Plan
    dateFormat YYYY-MM-DD
    section Planning
        Requirements Analysis :done, a1, 2024-01-01, 30d
        Design Phase :active, a2, after a1, 20d
    section Development
        Backend Development :a3, after a2, 40d""",

    'pie': """You are a Mermaid pie chart generator. You ONLY output valid Mermaid JS code.

RULES:
- Start with 'pie' on the first line
- Labels must be in double quotes
- Values must be numbers

Example:
pie
    title Browser Market Share
    "Chrome" : 65
    "Safari" : 19
    "Firefox" : 4""",

    'xy': """You are a Mermaid XY/Bar chart generator. You ONLY output valid Mermaid JS code.

RULES:
- Start with 'xychart-beta' on the first line

Example:
xychart-beta
    title Monthly Revenue
    x-axis [Jan, Feb, Mar, Apr, May, Jun]
    y-axis "Revenue" 0 --> 10000
    bar [5000, 6000, 7500, 8200, 9100, 9800]""",

    'er': """You are a Mermaid ER diagram generator. You ONLY output valid Mermaid JS code.

Example:
erDiagram
    USER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    USER {
        int id
        string name
        string email
    }""",

    'state': """You are a Mermaid state diagram generator. You ONLY output valid Mermaid JS code.

Example:
stateDiagram-v2
    [*] --> Idle
    Idle --> Processing : Submit
    Processing --> Success : Valid
    Success --> [*]""",

    'class': """You are a Mermaid class diagram generator. You ONLY output valid Mermaid JS code.

Example:
classDiagram
    class Animal {
        +String name
        +makeSound()
    }
    class Dog {
        +fetch()
    }
    Animal <|-- Dog""",

    'git': """You are a Mermaid gitgraph generator. You ONLY output valid Mermaid JS code.

CRITICAL RULES:
- Start with 'gitGraph' on the first line
- Use only: commit, branch, checkout, merge
- Commit messages with 'commit id:' (NOT 'commit msg:')
- Branch names must be single words

Example:
gitGraph
    commit id: "Initial Commit"
    commit id: "Add README"
    branch develop
    checkout develop
    commit id: "Add feature A"
    checkout main
    merge develop
    commit id: "Release v1.0" """,

    'quadrant': """You are an expert Mermaid quadrant chart generator. You ONLY output valid Mermaid JS code.

CRITICAL RULES:
- NEVER use markdown code fences
- NEVER use parentheses () or brackets [] in axis labels or point names.
- Axis labels MUST strictly be: 'x-axis Left Label --> Right Label' without special characters.

Example:
quadrantChart
    title Task Priority Matrix
    x-axis Low Effort --> High Effort
    y-axis Low Impact --> High Impact
    quadrant-1 Do First
    quadrant-2 Schedule
    quadrant-3 Delegate
    quadrant-4 Eliminate
    Task A: [0.3, 0.8]
    Task B: [0.7, 0.9]""",

    'treemap': """You are a Mermaid mindmap generator. You ONLY output valid Mermaid JS code.

RULES:
- Start with 'mindmap' on the first line
- Use indentation for hierarchy
- Keep node names short

Example:
mindmap
    root((Project))
        Frontend
            React
            CSS
        Backend
            Node.js
            Database"""
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

    return cleaned


def _fix_gantt(code):
    lines = code.split('\n')
    fixed = []
    has_date_format = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('dateFormat'):
            has_date_format = True
        if stripped.startswith('section '):
            stripped = re.sub(r'[()\\]', '', stripped)
            line = '    ' + stripped
        if ':' in stripped and not stripped.startswith(('section', 'dateFormat', 'title', 'gantt', 'axisFormat', 'todayMarker', 'tickInterval')):
            parts = stripped.split(':', 1)
            task_name = re.sub(r'[()\\]', '', parts[0]).strip()
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
            line = re.sub(r'[()\\]', '', line)
        if stripped.startswith('section '):
            line = re.sub(r'[()\\]', '', line)
        fixed.append(line)
    return '\n'.join(fixed)


def _fix_gitgraph(code):
    lines = code.split('\n')
    fixed = []
    for line in lines:
        stripped = line.strip()
        if 'commit msg:' in stripped:
            line = line.replace('commit msg:', 'commit id:')
        if 'commit id:' in stripped:
            line = re.sub(r'[()\\]', '', line)
        if stripped.startswith('branch '):
            branch_name = stripped[7:].strip()
            branch_name = re.sub(r'[^a-zA-Z0-9_/-]', '-', branch_name)
            line = '    branch ' + branch_name
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
            line = re.sub(r'\\', '', line)
        fixed.append(line)
    return '\n'.join(fixed)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)

            user_prompt = data.get('prompt', '')
            mode = data.get('mode', 'flowchart')

            if not user_prompt.strip():
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Please provide a description.'}).encode())
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
                    {'role': 'user', 'content': f"Generate a {mode} diagram in Mermaid JS for: {user_prompt}"}
                ],
                'temperature': 0.3,
                'max_tokens': 2048
            }

            MAX_RETRIES = 3
            bridge_code = None
            result = None
            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    response = requests.post(SARVAM_API_URL, headers=headers, json=payload, timeout=60)
                    if response.status_code != 200:
                        if response.status_code in (429, 500, 502, 503, 504) and attempt < MAX_RETRIES:
                            time.sleep(2 ** attempt)
                            continue
                        self.send_response(502)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('Access-Control-Allow-Origin', '*')
                        self.end_headers()
                        self.wfile.write(json.dumps({'error': f'AI service returned status {response.status_code}'}).encode())
                        return

                    result = response.json()
                    content = result.get('choices', [{}])[0].get('message', {}).get('content', '').strip()
                    if not content and attempt < MAX_RETRIES:
                        time.sleep(2 ** attempt)
                        continue
                    bridge_code = clean_mermaid_code(content, mode)
                    break
                except (requests.exceptions.Timeout, requests.exceptions.ConnectionError):
                    if attempt < MAX_RETRIES:
                        time.sleep(2 ** attempt)
                        continue
                    raise

            if not bridge_code:
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Failed to generate diagram after multiple attempts.'}).encode())
                return

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                'success': True,
                'code': bridge_code,
                'usage': result.get('usage', {}) if result else {}
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
