from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
import requests
import json
import os
import time
import re
import sys

# ── Fix Windows console Unicode encoding ─────────────────────────────────────
# Windows cmd/powershell uses cp1252 by default which can't handle ₹, ™, etc.
# This prevents UnicodeEncodeError from crashing the server when logging.
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except (AttributeError, OSError):
    pass  # Fallback for older Python versions


def safe_print(*args, **kwargs):
    """Print that won't crash on Unicode characters on Windows."""
    try:
        print(*args, **kwargs)
    except UnicodeEncodeError:
        # Fallback: encode to ascii replacing problem chars
        text = ' '.join(str(a) for a in args)
        print(text.encode('ascii', errors='replace').decode('ascii'), **kwargs)


app = Flask(__name__)
CORS(app)

# ── Sarvam M API Configuration ──────────────────────────────────────────────
SARVAM_API_KEY = "sk_h10vkdry_WChEvgrtvbYb4iQPe1hNVmWT"
SARVAM_API_URL = "https://api.sarvam.ai/v1/chat/completions"

# ═══════════════════════════════════════════════════════════════════════════════
# Mermaid System Prompts definition
# ═══════════════════════════════════════════════════════════════════════════════
MERMAID_SYSTEM_PROMPTS = {
    'flowchart': """You are an expert Mermaid flowchart generator. You ONLY output valid, pristine Mermaid JS syntax. Your entire response must be ONLY valid Mermaid flowchart code.

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
  A[Start] --> B{Condition?}
  B -- Yes --> C[Process]
  B -- No --> D[Error]
  C --> E[End Process]
  D --> E""",

    'block': """You are an expert Mermaid block diagram code generator. You ONLY output valid Mermaid JS code. You NEVER explain, comment, or add anything outside the Mermaid code.

CRITICAL RULES:
- NEVER use markdown blocks (no ```)
- ALWAYS start with 'graph LR' or 'graph TD'
- SUBGRAPHS MUST be closed with the exact word 'end' on a new line. NEVER use 'end subgraph', 'End', or 'END'.
- LABELS MUST NOT contain parentheses () or backslashes.
- Node IDs must be simple alphanumeric strings without spaces.

Example:
graph LR
  subgraph Client Area
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

    'architecture': """You are an expert Mermaid architecture diagram code generator. You ONLY output valid Mermaid JS code. You NEVER explain, comment, or add anything outside the Mermaid code.

CRITICAL RULES:
- NEVER use markdown blocks (no ```)
- Use 'graph TD' or 'graph LR'
- SUBGRAPHS MUST be closed with the exact word 'end' on a new line. NEVER use 'end subgraph' or 'END'.
- Do NOT use parentheses inside node labels.

Example:
graph TB
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

    'sequence': """You are a Mermaid sequence diagram generator. You ONLY output valid Mermaid JS code. You NEVER explain, comment, or add anything outside the Mermaid code.

RULES:
- Do NOT use markdown code fences
- Do NOT add any text or explanations
- Start with sequenceDiagram on first line
- Use participant or actor declarations
- Use ->> for solid arrows, -->> for dashed arrows

Example:
sequenceDiagram
    participant User
    participant Server
    participant DB
    User->>Server: Login Request
    Server->>DB: Query User
    DB-->>Server: User Data
    Server-->>User: Auth Token""",

    'timeline': """You are a Mermaid timeline generator. You ONLY output valid Mermaid JS code. You NEVER explain, comment, or add anything outside the Mermaid code.

CRITICAL RULES:
- Do NOT use markdown code fences
- Do NOT add any text or explanations
- Start with 'timeline' on the first line
- The second line MUST be 'title Your Timeline Title'
- Use sections with 'section Section Name'
- Each event is on its own line with the format: Year : Event description
- Do NOT use parentheses () in event descriptions -- replace with dashes or remove them
- Do NOT use special characters like backslashes
- Keep event descriptions short, no more than 10 words

Example:
timeline
    title History of Social Media
    section Early Days
        2002 : LinkedIn launched
        2004 : Facebook launched
    section Growth Era
        2006 : Twitter launched
        2010 : Instagram launched
    section Modern Era
        2016 : TikTok launched
        2020 : Social media boom""",

    'gantt': """You are a Mermaid Gantt chart generator. You ONLY output valid Mermaid JS code. You NEVER explain, comment, or add anything outside the Mermaid code.

CRITICAL RULES:
- Do NOT use markdown code fences
- Do NOT add any text or explanations
- Start with 'gantt' on the first line
- Include 'dateFormat YYYY-MM-DD' on the second line
- Do NOT use backslashes (\\) in task names
- Do NOT use parentheses () in task names
- Each task MUST have a valid format: TaskName :status, id, startDate, duration
- Use simple short task names without special characters
- Valid statuses: done, active, crit, or leave empty
- Duration format: 30d (days), 2w (weeks), etc.

Example:
gantt
    title Project Plan
    dateFormat YYYY-MM-DD
    section Planning
        Requirements Analysis :done, a1, 2024-01-01, 30d
        Design Phase :active, a2, after a1, 20d
    section Development
        Backend Development :a3, after a2, 40d
        Frontend Development :a4, after a2, 35d
    section Testing
        QA Testing :a5, after a3, 15d
        Deployment :a6, after a5, 5d""",

    'pie': """You are a Mermaid pie chart generator. You ONLY output valid Mermaid JS code. You NEVER explain, comment, or add anything outside the Mermaid code.

RULES:
- Do NOT use markdown code fences
- Do NOT add any text or explanations
- Start with 'pie' on the first line
- Optionally add 'title Your Title' on the next line
- Each slice: "Label" : value
- Labels must be in double quotes
- Values must be numbers

Example:
pie
    title Browser Market Share
    "Chrome" : 65
    "Safari" : 19
    "Firefox" : 4
    "Edge" : 4
    "Others" : 8""",

    'xy': """You are a Mermaid XY/Bar chart generator (xychart-beta). You ONLY output valid Mermaid JS code. You NEVER explain, comment, or add anything outside the Mermaid code.

RULES:
- Do NOT use markdown code fences
- Do NOT add any text or explanations
- Start with 'xychart-beta' on the first line
- Use 'title' for chart title
- x-axis with bracket notation for labels
- y-axis with optional range
- Use 'bar' or 'line' for data series

Example:
xychart-beta
    title Monthly Revenue
    x-axis [Jan, Feb, Mar, Apr, May, Jun]
    y-axis "Revenue in USD" 0 --> 10000
    bar [5000, 6000, 7500, 8200, 9100, 9800]
    line [5000, 6000, 7500, 8200, 9100, 9800]""",

    'er': """You are a Mermaid Entity Relationship (ER) diagram generator. You ONLY output valid Mermaid JS code. You NEVER explain, comment, or add anything outside the Mermaid code.

RULES:
- Do NOT use markdown code fences
- Do NOT add any text or explanations
- Start with 'erDiagram' on the first line
- Use proper relationship notation

Example:
erDiagram
    USER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : includes
    USER {
        int id
        string name
        string email
    }
    ORDER {
        int id
        date created
        string status
    }""",

    'state': """You are a Mermaid state diagram generator. You ONLY output valid Mermaid JS code. You NEVER explain, comment, or add anything outside the Mermaid code.

RULES:
- Do NOT use markdown code fences
- Do NOT add any text or explanations
- Start with 'stateDiagram-v2' on the first line
- Use [*] for start and end states

Example:
stateDiagram-v2
    [*] --> Idle
    Idle --> Processing : Submit
    Processing --> Success : Valid
    Processing --> Error : Invalid
    Error --> Idle : Retry
    Success --> [*]""",

    'class': """You are a Mermaid class diagram generator. You ONLY output valid Mermaid JS code. You NEVER explain, comment, or add anything outside the Mermaid code.

RULES:
- Do NOT use markdown code fences
- Do NOT add any text or explanations
- Start with 'classDiagram' on the first line

Example:
classDiagram
    class Animal {
        +String name
        +int age
        +makeSound()
    }
    class Dog {
        +String breed
        +fetch()
    }
    Animal <|-- Dog""",

    'git': """You are a Mermaid gitgraph generator. You ONLY output valid Mermaid JS code. You NEVER explain, comment, or add anything outside the Mermaid code.

CRITICAL RULES:
- Do NOT use markdown code fences
- Do NOT add any text or explanations
- Start with 'gitGraph' on the first line
- Use only these commands: commit, branch, checkout, merge
- Commit messages must be in double quotes after 'id:'
- Do NOT use 'commit msg:' -- use 'commit id:' instead
- Do NOT use parentheses or backslashes in commit messages
- Branch names must be single words without special chars

Example:
gitGraph
    commit id: "Initial Commit"
    commit id: "Add README"
    branch develop
    checkout develop
    commit id: "Add feature A"
    commit id: "Add feature B"
    checkout main
    merge develop
    commit id: "Release v1.0" """,

    'quadrant': """You are an expert Mermaid quadrant chart generator. You ONLY output valid Mermaid JS code. You NEVER explain, comment, or add anything outside the Mermaid code.

CRITICAL RULES:
- Do NOT use markdown code fences
- Do NOT add any text or explanations
- Start with 'quadrantChart' on the first line
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
    Task B: [0.7, 0.9]
    Task C: [0.2, 0.3]
    Task D: [0.8, 0.2]""",

    'treemap': """You are a Mermaid mindmap generator. You ONLY output valid Mermaid JS code. You NEVER explain, comment, or add anything outside the Mermaid code.

CRITICAL RULES:
- Do NOT use markdown code fences
- Do NOT add any text or explanations
- Start with 'mindmap' on the first line
- Use indentation (spaces) to show hierarchy
- Root node on the second line with no indent
- Children indented with more spaces
- Do NOT use parentheses in node names
- Do NOT use special characters
- Keep node names short, 1-4 words

Example:
mindmap
    root((Project))
        Frontend
            React
            CSS
            HTML
        Backend
            Node.js
            Database
            API
        DevOps
            Docker
            CI/CD"""
}

def get_system_prompt(mode):
    return MERMAID_SYSTEM_PROMPTS.get(mode, MERMAID_SYSTEM_PROMPTS['flowchart'])


# Known Mermaid diagram type keywords that should start valid code
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
    """Post-process AI-generated code to extract valid mermaid blocks and fix common issues."""
    if not code:
        return code

    # Remove markdown fencing (```mermaid ... ``` or ```json ... ```)
    code = re.sub(r'```(?:mermaid|json|text)?\s*\n?', '', code).strip()

    # If the AI added conversational text before the actual code,
    # try to find where the real mermaid code starts
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

    # Remove any trailing conversational text after the diagram
    # (lines that look like plain prose after a gap)
    cleaned = '\n'.join(lines).strip()

    # ── Mode-specific fixes ───────────────────────────────────────────
    cleaned = fix_mermaid_syntax(cleaned, mode)

    return cleaned


def fix_mermaid_syntax(code, mode):
    """Apply mode-specific syntax fixes to common AI generation errors."""
    if not code:
        return code

    # Universal fixes
    # Remove backslashes that aren't part of valid escape sequences
    code = code.replace('\\n', ' ').replace('\\t', ' ')
    # Remove stray backslashes in labels (e.g. "Puberty \" -> "Puberty")
    code = re.sub(r'\\(?!["\\nrt])', '', code)

    if mode in ('flowchart', 'block', 'architecture'):
        # Fix parser errors caused by unquoted parentheses in node text
        # Only removes ( and ) that are NOT part of shape markers like [(, ([
        code = re.sub(r'(?<![\[\]\|])\((?![\[\]\|])', ' ', code)
        code = re.sub(r'(?<![\[\]\|])\)(?![\[\]\|])', ' ', code)

    if mode == 'gantt':
        code = _fix_gantt(code)
    elif mode == 'timeline':
        code = _fix_timeline(code)
    elif mode == 'git':
        code = _fix_gitgraph(code)
    elif mode == 'pie':
        code = _fix_pie(code)
    elif mode == 'treemap':
        code = _fix_mindmap(code)

    return code


def _fix_gantt(code):
    """Fix common Gantt chart syntax issues."""
    lines = code.split('\n')
    fixed = []
    has_date_format = False
    has_title = False

    for line in lines:
        stripped = line.strip()

        # Track if dateFormat exists
        if stripped.startswith('dateFormat'):
            has_date_format = True

        if stripped.startswith('title'):
            has_title = True

        # Remove parentheses from task names (common AI mistake)
        # e.g. "Early Teenage (13-15)" -> "Early Teenage 13-15"
        if stripped.startswith('section '):
            stripped = re.sub(r'[()\\]', '', stripped)
            line = '    ' + stripped

        # Fix task lines: remove backslashes and parentheses from task names
        if ':' in stripped and not stripped.startswith('section') and \
           not stripped.startswith('dateFormat') and not stripped.startswith('title') and \
           not stripped.startswith('gantt') and not stripped.startswith('axisFormat') and \
           not stripped.startswith('todayMarker') and not stripped.startswith('tickInterval'):
            # Clean parentheses and backslashes from the task name part
            parts = stripped.split(':', 1)
            task_name = re.sub(r'[()\\]', '', parts[0]).strip()
            if len(parts) > 1:
                task_meta = parts[1].strip()
                # If task meta is empty or invalid, add a default duration
                if not task_meta or task_meta.isspace():
                    task_meta = '2024-01-01, 30d'
                line = '        ' + task_name + ' :' + task_meta
            else:
                line = '        ' + task_name + ' :2024-01-01, 30d'

        fixed.append(line)

    result = '\n'.join(fixed)

    # Ensure gantt has a dateFormat line
    if not has_date_format:
        result = result.replace('gantt', 'gantt\n    dateFormat YYYY-MM-DD', 1)

    return result


def _fix_timeline(code):
    """Fix common Timeline syntax issues."""
    lines = code.split('\n')
    fixed = []

    for line in lines:
        stripped = line.strip()

        # Remove parentheses from timeline event descriptions
        # e.g. "2020 : COVID-19 (pandemic)" -> "2020 : COVID-19 pandemic"
        if ':' in stripped and not stripped.startswith('title') and \
           not stripped.startswith('timeline') and not stripped.startswith('section'):
            line = re.sub(r'[()\\]', '', line)

        # Also fix section names
        if stripped.startswith('section '):
            line = re.sub(r'[()\\]', '', line)

        fixed.append(line)

    return '\n'.join(fixed)


def _fix_gitgraph(code):
    """Fix common gitGraph syntax issues."""
    lines = code.split('\n')
    fixed = []

    for line in lines:
        stripped = line.strip()

        # Fix 'commit msg:' -> 'commit id:' (common AI mistake)
        if 'commit msg:' in stripped:
            line = line.replace('commit msg:', 'commit id:')

        # Remove parentheses from commit messages
        if 'commit id:' in stripped:
            line = re.sub(r'[()\\]', '', line)

        # Fix branch names with spaces or special chars
        if stripped.startswith('branch '):
            branch_name = stripped[7:].strip()
            # Replace spaces and special chars with hyphens
            branch_name = re.sub(r'[^a-zA-Z0-9_/-]', '-', branch_name)
            line = '    branch ' + branch_name

        fixed.append(line)

    return '\n'.join(fixed)


def _fix_pie(code):
    """Fix common pie chart syntax issues."""
    lines = code.split('\n')
    fixed = []

    for line in lines:
        stripped = line.strip()

        # Ensure labels are in double quotes
        # e.g. Chrome : 65 -> "Chrome" : 65
        if ':' in stripped and not stripped.startswith('title') and not stripped.startswith('pie'):
            parts = stripped.split(':', 1)
            label = parts[0].strip().strip('"').strip("'")
            value = parts[1].strip()
            line = '    "' + label + '" : ' + value

        fixed.append(line)

    return '\n'.join(fixed)


def _fix_mindmap(code):
    """Fix common mindmap syntax issues."""
    lines = code.split('\n')
    fixed = []

    for line in lines:
        # Remove problematic characters from node names
        if not line.strip().startswith('mindmap'):
            line = re.sub(r'\\', '', line)

        fixed.append(line)

    return '\n'.join(fixed)


@app.route('/')
@app.route('/index.html')
def index():
    """Serve the main frontend page."""
    return render_template('index.html')


@app.route('/api/generate', methods=['POST'])
def generate_diagram():
    """
    Receives a natural language description from the user,
    sends it to SarvamM to translate into Bridge Language,
    and returns the Bridge Language code to the frontend.
    """
    try:
        data = request.get_json()
        user_prompt = data.get('prompt', '')
        mode = data.get('mode', 'flowchart')

        if not user_prompt.strip():
            return jsonify({'error': 'Please provide a description.'}), 400

        # Call Sarvam M API
        headers = {
            'Content-Type': 'application/json',
            'api-subscription-key': SARVAM_API_KEY
        }

        payload = {
            'model': 'sarvam-m',
            'messages': [
                {
                    'role': 'system',
                    'content': get_system_prompt(mode)
                },
                {
                    'role': 'user',
                    'content': f"Generate a {mode} diagram in Mermaid JS for: {user_prompt}"
                }
            ],
            'temperature': 0.3,
            'max_tokens': 2048
        }

        # Retry logic for transient API failures
        MAX_RETRIES = 3
        bridge_code = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                safe_print(f"[Generate] Attempt {attempt}/{MAX_RETRIES} for mode={mode}")
                response = requests.post(SARVAM_API_URL, headers=headers, json=payload, timeout=60)

                if response.status_code != 200:
                    error_detail = response.text
                    safe_print(f"Sarvam API Error [{response.status_code}]: {error_detail}")
                    if response.status_code in (429, 500, 502, 503, 504) and attempt < MAX_RETRIES:
                        time.sleep(2 ** attempt)
                        continue
                    return jsonify({
                        'error': f'AI service returned status {response.status_code}',
                        'detail': error_detail
                    }), 502

                result = response.json()
                content = result.get('choices', [{}])[0].get('message', {}).get('content', '').strip()
                if not content and attempt < MAX_RETRIES:
                    safe_print(f"[Generate] Empty content on attempt {attempt}, retrying...")
                    time.sleep(2 ** attempt)
                    continue
                bridge_code = clean_mermaid_code(content, mode)
                break
            except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                safe_print(f"[Generate] {type(e).__name__} on attempt {attempt}")
                if attempt < MAX_RETRIES:
                    time.sleep(2 ** attempt)
                    continue
                raise

        if not bridge_code:
            return jsonify({'error': 'Failed to generate diagram after multiple attempts.'}), 502

        return jsonify({
            'success': True,
            'code': bridge_code,
            'usage': result.get('usage', {})
        })

    except requests.exceptions.Timeout:
        return jsonify({'error': 'The AI service timed out. Please try again.'}), 504
    except requests.exceptions.ConnectionError:
        return jsonify({'error': 'Could not connect to the AI service.'}), 503
    except Exception as e:
        print(f"Server error: {str(e)}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@app.route('/api/refine', methods=['POST'])
def refine_diagram():
    """
    Takes existing Bridge Language code and a refinement instruction,
    sends both to SarvamM to produce an updated version.
    """
    try:
        data = request.get_json()
        current_code = data.get('current_code', '')
        instruction = data.get('instruction', '')
        mode = data.get('mode', 'flowchart')

        if not instruction.strip():
            return jsonify({'error': 'Please provide a refinement instruction.'}), 400

        headers = {
            'Content-Type': 'application/json',
            'api-subscription-key': SARVAM_API_KEY
        }

        payload = {
            'model': 'sarvam-m',
            'messages': [
                {
                    'role': 'system',
                    'content': get_system_prompt(mode)
                },
                {
                    'role': 'user',
                    'content': f"Here is my current {mode} diagram code:\n{current_code}\n\nPlease modify it with this instruction: {instruction}\n\nOutput ONLY the complete updated Mermaid JS code."
                }
            ],
            'temperature': 0.3,
            'max_tokens': 2048
        }

        response = requests.post(SARVAM_API_URL, headers=headers, json=payload, timeout=60)

        if response.status_code != 200:
            return jsonify({'error': f'AI service returned status {response.status_code}'}), 502

        result = response.json()
        bridge_code = result['choices'][0]['message']['content'].strip()
        bridge_code = clean_mermaid_code(bridge_code, mode)

        return jsonify({
            'success': True,
            'code': bridge_code,
            'usage': result.get('usage', {})
        })

    except Exception as e:
        print(f"Refine error: {str(e)}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500


# ── AI Legal Assistant Configuration ─────────────────────────────────────────

LAW_SYSTEM_PROMPT = """You are an AI legal assistant specializing in Indian law. Your goal is to help users with legal issues, such as harassment, unjust fees, consumer rights, etc.

IMPORTANT INTERACTION RULES:
1. You must FIRST gather enough information by asking 3-5 questions one at a time.
2. For EACH question, provide 3-5 clickable answer options relevant to the question.
3. After gathering enough information (typically after 3-5 exchanges), provide a FINAL comprehensive legal response.

RESPONSE FORMAT - You MUST respond in ONLY one of these two JSON formats:

FORMAT 1 - QUESTIONING PHASE (when you still need more information):
{
  "phase": "questioning",
  "message": "A brief acknowledgment or context about what you understood so far.",
  "question": "Your specific question to the user",
  "options": ["Option 1", "Option 2", "Option 3", "Option 4"]
}
The frontend will automatically add an "Others" option that lets the user type custom input.

FORMAT 2 - FINAL RESPONSE PHASE (when you have enough information to give advice):
{
  "phase": "final",
  "cards": {
    "issue_summary": "A clear, concise summary of the user's legal issue based on all gathered information.",
    "legal_classification": "The legal classification of the issue (e.g., Criminal, Civil, Consumer, Constitutional, etc.) with explanation.",
    "applicable_laws": "List all applicable laws, sections, and acts relevant to this issue. Format each law on a new line.",
    "risk_urgency": {"level": "HIGH/MEDIUM/LOW", "description": "Explanation of the urgency and potential risks if not addressed."},
    "official_resources": "Links and references to official government websites, portals, helplines for reporting or seeking help. Include actual URLs where possible.",
    "action_plan": "A numbered step-by-step immediate action plan the user should follow.",
    "required_documents": "List of documents the user should gather or prepare for their case.",
    "preventive_advice": "Optional preventive advice to avoid similar issues in the future. Can be empty string if not applicable."
  }
}

ADDITIONAL GUIDELINES:
- Reference past court or authority rulings related to the issue, if applicable.
- If the issue is related to a university or institute, suggest checking their official rule books and UGC/AICTE guidelines.
- Provide information from official datasets/sources, keeping in mind that every state in India may have specific laws.
- Keep options concise but descriptive enough for the user to understand.
- Ensure the response is a valid JSON object. Do not add markdown fences like ```json.
"""

@app.route('/law-bot')
def law_bot():
    """Serve the Law Bot frontend page."""
    return render_template('law_bot.html')

@app.route('/login')
@app.route('/login.html')
def login():
    """Serve the Login page."""
    return render_template('login.html')

@app.route('/signup')
@app.route('/signup.html')
def signup():
    """Serve the Signup page."""
    return render_template('signup.html')

@app.route('/about')
@app.route('/about.html')
def about():
    """Serve the About Landing page."""
    return render_template('about.html')

@app.route('/api/law-chat', methods=['POST'])
def law_chat():
    """
    Receives user query, sends it to SarvamM with the law system prompt,
    and returns a structured JSON (message and questions) to the frontend.
    Includes retry logic for transient Sarvam API failures.
    """
    try:
        data = request.get_json()
        user_prompt = data.get('prompt', '')
        chat_history = data.get('history', [])

        if not user_prompt.strip():
            return jsonify({'error': 'Please provide a message.'}), 400

        headers = {
            'Content-Type': 'application/json',
            'api-subscription-key': SARVAM_API_KEY
        }
        
        # Build messages with history
        messages = [
            {'role': 'system', 'content': LAW_SYSTEM_PROMPT}
        ]
        
        # Add history
        last_role = 'system'
        for msg in chat_history:
             role = 'user' if msg.get('role') == 'user' else 'assistant'
             content = msg.get('content', '')
             if not content: continue
             # Avoid consecutive duplicate roles
             if role == last_role:
                  messages[-1]['content'] += f"\n\n{content}"
             else:
                  messages.append({'role': role, 'content': content})
             last_role = role
             
        # Add current user prompt if it isn't already the last added message
        if last_role != 'user' or messages[-1]['content'].strip() != user_prompt.strip():
             messages.append({'role': 'user', 'content': user_prompt})

        payload = {
            'model': 'sarvam-m',
            'messages': messages,
            'temperature': 0.3,
            'max_tokens': 2048
        }

        # ── Retry logic for transient Sarvam API failures ─────────────────
        MAX_RETRIES = 3
        law_response = None
        last_error = None

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                safe_print(f"[LawBot] Attempt {attempt}/{MAX_RETRIES} - Sending request to Sarvam API...")
                response = requests.post(SARVAM_API_URL, headers=headers, json=payload, timeout=90)
                safe_print(f"[LawBot] Sarvam API responded with status: {response.status_code}")

                if response.status_code != 200:
                    error_detail = response.text
                    safe_print(f"[LawBot] API Error [{response.status_code}]: {error_detail}")
                    # 429 (rate limit) and 5xx (server errors) are retryable
                    if response.status_code in (429, 500, 502, 503, 504) and attempt < MAX_RETRIES:
                        wait_time = 2 ** attempt  # 2s, 4s, 8s
                        safe_print(f"[LawBot] Retryable status {response.status_code}, waiting {wait_time}s...")
                        time.sleep(wait_time)
                        continue
                    return jsonify({
                        'error': f'AI service returned status {response.status_code}',
                        'detail': error_detail
                    }), 502

                # Check for empty response body
                response_text = response.text.strip()
                if not response_text:
                    safe_print(f"[LawBot] WARNING: Empty response body on attempt {attempt}")
                    if attempt < MAX_RETRIES:
                        wait_time = 2 ** attempt
                        safe_print(f"[LawBot] Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                        continue
                    return jsonify({
                        'error': 'AI service returned an empty response after multiple retries. Please try again.'
                    }), 502

                # Parse the API response
                try:
                    result = json.loads(response_text)
                except json.JSONDecodeError as je:
                    safe_print(f"[LawBot] WARNING: Failed to parse API response as JSON on attempt {attempt}: {je}")
                    safe_print(f"[LawBot] Raw response (first 500 chars): {response_text[:500]}")
                    if attempt < MAX_RETRIES:
                        wait_time = 2 ** attempt
                        safe_print(f"[LawBot] Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                        continue
                    return jsonify({
                        'error': 'AI service returned an invalid response. Please try again.'
                    }), 502

                # Extract content from choices
                choices = result.get('choices', [])
                if not choices or not choices[0].get('message', {}).get('content'):
                    safe_print(f"[LawBot] WARNING: No valid content in choices on attempt {attempt}")
                    safe_print(f"[LawBot] Result keys: {list(result.keys())}")
                    if attempt < MAX_RETRIES:
                        wait_time = 2 ** attempt
                        safe_print(f"[LawBot] Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                        continue
                    return jsonify({
                        'error': 'AI service returned a response with no content. Please try again.'
                    }), 502

                law_response = choices[0]['message']['content'].strip()
                if not law_response:
                    safe_print(f"[LawBot] WARNING: Empty content string on attempt {attempt}")
                    if attempt < MAX_RETRIES:
                        wait_time = 2 ** attempt
                        safe_print(f"[LawBot] Retrying in {wait_time}s...")
                        time.sleep(wait_time)
                        continue
                    return jsonify({
                        'error': 'AI service returned empty content. Please try again.'
                    }), 502

                # Successfully got a response — break out of retry loop
                safe_print(f"[LawBot] Got valid response on attempt {attempt} (length: {len(law_response)})")
                break

            except requests.exceptions.Timeout:
                last_error = 'timeout'
                safe_print(f"[LawBot] Timeout on attempt {attempt}")
                if attempt < MAX_RETRIES:
                    wait_time = 2 ** attempt
                    safe_print(f"[LawBot] Retrying in {wait_time}s...")
                    time.sleep(wait_time)
                    continue
                return jsonify({'error': 'The AI service timed out after multiple retries. Please try again.'}), 504

            except requests.exceptions.ConnectionError as e:
                last_error = str(e)
                safe_print(f"[LawBot] Connection error on attempt {attempt}: {e}")
                if attempt < MAX_RETRIES:
                    wait_time = 2 ** attempt
                    safe_print(f"[LawBot] Retrying in {wait_time}s...")
                    time.sleep(wait_time)
                    continue
                return jsonify({'error': 'Could not connect to the AI service after multiple retries.'}), 503

            except requests.exceptions.SSLError as e:
                last_error = str(e)
                safe_print(f"[LawBot] SSL error on attempt {attempt}: {e}")
                if attempt < MAX_RETRIES:
                    wait_time = 2 ** attempt
                    safe_print(f"[LawBot] Retrying in {wait_time}s...")
                    time.sleep(wait_time)
                    continue
                return jsonify({'error': 'SSL connection error after multiple retries.'}), 503

        # If we got here without law_response, something unexpected happened
        if not law_response:
            return jsonify({'error': 'Failed to get a response from the AI service. Please try again.'}), 502

        # ── Robust JSON extraction ───────────────────────────────────────

        # Step 1: Remove BOM and invisible characters
        law_response = law_response.lstrip('\ufeff\u200b\u200c\u200d')

        # Step 2: Strip ALL markdown code fences (```json ... ``` or ``` ... ```)
        law_response = re.sub(r'```(?:json|JSON)?\s*\n?', '', law_response).strip()

        # Step 3: Try direct JSON parse
        parsed = None
        try:
            parsed = json.loads(law_response)
            safe_print(f"[LawBot] Direct JSON parse succeeded")
        except json.JSONDecodeError:
            safe_print(f"[LawBot] Direct parse failed, trying extraction...")

        # Step 4: If direct parse failed, extract the first complete JSON object
        if parsed is None:
            # Find the first '{' and match it to its closing '}'
            first_brace = law_response.find('{')
            if first_brace != -1:
                depth = 0
                in_string = False
                escape_next = False
                end_pos = -1
                for i in range(first_brace, len(law_response)):
                    c = law_response[i]
                    if escape_next:
                        escape_next = False
                        continue
                    if c == '\\' and in_string:
                        escape_next = True
                        continue
                    if c == '"' and not escape_next:
                        in_string = not in_string
                        continue
                    if not in_string:
                        if c == '{':
                            depth += 1
                        elif c == '}':
                            depth -= 1
                            if depth == 0:
                                end_pos = i
                                break
                if end_pos != -1:
                    json_str = law_response[first_brace:end_pos + 1]
                    try:
                        parsed = json.loads(json_str)
                        safe_print(f"[LawBot] Extracted JSON from position {first_brace}-{end_pos}")
                    except json.JSONDecodeError:
                        safe_print(f"[LawBot] Extracted JSON also failed to parse")

        # Step 5: Final fallback — wrap as plain message
        if parsed is None:
            safe_print(f"[LawBot] All JSON parsing failed, using fallback")
            parsed = {
                "phase": "questioning",
                "message": law_response,
                "question": "",
                "options": []
            }

        safe_print(f"[LawBot] Successfully processed response (phase: {parsed.get('phase', 'unknown')})")
        return jsonify({
            'success': True,
            'response': parsed
        })

    except Exception as e:
        safe_print(f"[LawBot] ERROR: {type(e).__name__}: {str(e)}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000, threaded=True)
