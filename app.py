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

# ── Bridge Language System Prompt ────────────────────────────────────────────
BRIDGE_LANGUAGE_SYSTEM_PROMPT = """You are a flowchart code generator. You ONLY output code in a custom "Bridge Language" DSL. You NEVER explain, comment, or add anything outside the DSL code. Your entire response must be ONLY valid Bridge Language code.

BLOCK TYPES (use these exactly):
- ts()         → Start terminator (auto-text "Start")  
- te()         → End terminator (auto-text "End")
- t("text")    → General oval/terminator
- p["text"]    → Process/Action rectangle
- d<"text">    → Decision diamond
- l["text"]    → Input/Output parallelogram
- c[)          → Connector circle

ARROWS (always required between consecutive blocks):
- a>           → Forward/downward arrow (no label)
- a*label*>    → Labeled forward arrow (MUST have closing * before >)
- a<           → Backward arrow
- a*label*<    → Labeled backward arrow (MUST have closing * before <)

CRITICAL ARROW LABEL RULES:
- Labels MUST be enclosed between two * characters: a*Yes*> NOT a*Yes>
- The closing * before the direction symbol (> or <) is REQUIRED
- Each arrow label applies ONLY to the very next connection
- Never omit the closing * — it will break the parser

BRANCHING from decisions:
To create Yes/No branches from a decision, RESTATE the exact decision block code and add the branch arrow:

d<"Is valid?">
a*Yes*>
p["Process Data"]
a>
te()
d<"Is valid?">
a*No*>
p["Fix Errors"]
a>
te()

BRANCHING to multiple blocks at once (ma syntax):
When one block connects to multiple targets, use ma*label*> and list targets inside []:
d<"Check">
ma*Yes*>[
p["Action A"]
a*No*
p["Action B"]
]
NOTE: Inside ma blocks, each target node gets the group label unless overridden with a*custom label* on the line BEFORE the target node.

LOOPS (back-reference jumps):
p["Fix Errors"]a*Retry*>!d<"Is valid?">

STRICT FORMATTING RULES:
1. Phase 1 (Declaration): List ALL unique blocks one per line. NO arrows. NO duplicates.
2. Separator: Exactly five dots on their own line: .....
3. Phase 2 (Connections): Connect blocks with arrows. EVERY pair of consecutive blocks MUST have an arrow (a> or a*label*>) between them. NEVER list two blocks on consecutive lines without an arrow between them.
4. Phase 2 text MUST EXACTLY match Phase 1 text character-for-character.
5. Output ONLY valid Bridge Language code. No markdown fences, no explanations, no comments.
6. Keep flowcharts clean: 4-10 blocks is ideal, avoid unnecessary complexity.
7. Every block in Phase 1 must appear at least once in Phase 2.
8. A decision block can appear multiple times in Phase 2 to create different branches.
9. Arrow labels must ALWAYS use the format a*text*> with closing * — never a*text>

COMPLETE EXAMPLE - User Login Flow:
ts()
l["Enter credentials"]
d<"Valid credentials?">
p["Grant access"]
p["Show error message"]
d<"Retry limit reached?">
p["Lock account"]
te()
.....
ts()
a>
l["Enter credentials"]
a>
d<"Valid credentials?">
a*Yes*>
p["Grant access"]
a>
te()
d<"Valid credentials?">
a*No*>
p["Show error message"]
a>
d<"Retry limit reached?">
a*Yes*>
p["Lock account"]
a>
te()
d<"Retry limit reached?">
a*No*>
p["Show error message"]a*Retry*>!l["Enter credentials"]
"""

# ── Block Diagram Bridge Language System Prompt ──────────────────────────────
BLOCK_DIAGRAM_SYSTEM_PROMPT = """You are a block diagram code generator. You ONLY output code in a custom "Bridge Language" DSL. You NEVER explain, comment, or add anything outside the DSL code. Your entire response must be ONLY valid Bridge Language code.

BLOCK TYPES (use these exactly):
- t("text")    → Oval shape (for hubs, databases, endpoints)
- p["text"]    → Rectangle shape (for servers, modules, services)
- d<"text">    → Diamond shape (for load balancers, routers, decision points)
- l["text"]    → Parallelogram shape (for external APIs, I/O, external services)
- c[)          → Small connector circle (merge point)
- B{           → Complex container block with positional text:
    *tm: "Top Middle"
    *bm: "Bottom Middle"
    *tl: "Top Left"
    *tr: "Top Right"
    *bl: "Bottom Left"
    *br: "Bottom Right"
  }

ARROWS (always required between connected blocks):
- a>           → Forward/downward arrow (no label)
- a*label*>    → Labeled forward arrow (MUST have closing * before >)
- a<           → Backward/upward arrow
- a*label*<    → Labeled backward arrow (MUST have closing * before <)

CRITICAL ARROW LABEL RULES:
- Labels MUST be enclosed between two * characters: a*Request*> NOT a*Request>
- The closing * before the direction symbol (> or <) is REQUIRED
- Never omit the closing * — it will break the parser

BRANCHING OUT (one block sends to multiple):
p["Load Balancer"]
ma*routes to*>[
p["Server A"]
a*also routes to*
p["Server B"]
]
NOTE: Inside ma blocks, each target gets the group label unless overridden with a*custom label* on the line BEFORE the target node.

MERGING IN (multiple blocks feed into one):
t("Central Database")ma*saves data*<[
p["Server A"]
p["Server B"]
]

JUMP ARROWS (connect to previously declared blocks):
p["Module C"]a*feedback*>!p["Module A"]

STRICT FORMATTING RULES:
1. Phase 1 (Declaration): List ALL unique blocks one per line. NO arrows. NO duplicates.
2. Separator: Exactly five dots on their own line: .....
3. Phase 2 (Connections): Connect blocks with arrows. EVERY pair of consecutive blocks MUST have an arrow (a> or a*label*>) between them. NEVER write two block codes on consecutive lines without an arrow between them.
4. Phase 2 text MUST EXACTLY match Phase 1 text character-for-character.
5. Output ONLY valid Bridge Language code. No markdown fences, no explanations, no comments.
6. Do NOT use ts() or te(). Those are flowchart-only. Use t("text"), p["text"], etc.
7. Use appropriate shapes for different component types in the architecture.
8. Keep diagrams clean: 4-12 blocks is ideal.
9. Arrow labels must ALWAYS use the format a*text*> with closing * — never a*text>
10. CRITICAL: EVERY block declared in Phase 1 MUST be connected to at least one other block in Phase 2. No orphan/disconnected blocks allowed. If a block exists, it must have at least one arrow going to or from it.
11. In Phase 2, make sure the data/control flow is complete. Every block should be reachable from at least one other block.

COMPLETE EXAMPLE - Microservice Architecture:
p["Client App"]
l["API Gateway"]
d<"Auth Service">
p["User Service"]
p["Order Service"]
t("PostgreSQL DB")
t("Redis Cache")
.....
p["Client App"]
a*HTTP Request*>
l["API Gateway"]
a*Authenticate*>
d<"Auth Service">
ma*Authorized*>[
p["User Service"]
a*Route Order*
p["Order Service"]
]
p["User Service"]
a*Query*>
t("PostgreSQL DB")
p["Order Service"]
a*Query*>
t("PostgreSQL DB")
d<"Auth Service">
a*Cache Token*>
t("Redis Cache")
d<"Auth Service">a*Rejected*>!p["Client App"]
"""

@app.route('/')
def index():
    """Serve the main frontend page."""
    return render_template('index.html')


@app.route('/api/generate', methods=['POST'])
def generate_flowchart():
    """
    Receives a natural language description from the user,
    sends it to SarvamM to translate into Bridge Language,
    and returns the Bridge Language code to the frontend.
    """
    try:
        data = request.get_json()
        user_prompt = data.get('prompt', '')

        if not user_prompt.strip():
            return jsonify({'error': 'Please provide a description for the flowchart.'}), 400

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
                    'content': BRIDGE_LANGUAGE_SYSTEM_PROMPT
                },
                {
                    'role': 'user',
                    'content': f"Generate a flowchart in Bridge Language for: {user_prompt}"
                }
            ],
            'temperature': 0.3,
            'max_tokens': 2048
        }

        response = requests.post(SARVAM_API_URL, headers=headers, json=payload, timeout=60)

        if response.status_code != 200:
            error_detail = response.text
            print(f"Sarvam API Error [{response.status_code}]: {error_detail}")
            return jsonify({
                'error': f'AI service returned status {response.status_code}',
                'detail': error_detail
            }), 502

        result = response.json()
        bridge_code = result['choices'][0]['message']['content'].strip()

        # Clean up any accidental markdown fencing the LLM might add
        if bridge_code.startswith('```'):
            lines = bridge_code.split('\n')
            # Remove first line (```...) and last line (```)
            lines = [l for l in lines if not l.strip().startswith('```')]
            bridge_code = '\n'.join(lines).strip()

        return jsonify({
            'success': True,
            'bridge_code': bridge_code,
            'usage': result.get('usage', {})
        })

    except requests.exceptions.Timeout:
        return jsonify({'error': 'The AI service timed out. Please try again.'}), 504
    except requests.exceptions.ConnectionError:
        return jsonify({'error': 'Could not connect to the AI service.'}), 503
    except Exception as e:
        print(f"Server error: {str(e)}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/api/generate-block', methods=['POST'])
def generate_block_diagram():
    """
    Receives a natural language description from the user,
    sends it to SarvamM to translate into Bridge Language for block diagrams,
    and returns the Bridge Language code to the frontend.
    """
    try:
        data = request.get_json()
        user_prompt = data.get('prompt', '')

        if not user_prompt.strip():
            return jsonify({'error': 'Please provide a description for the block diagram.'}), 400

        headers = {
            'Content-Type': 'application/json',
            'api-subscription-key': SARVAM_API_KEY
        }

        payload = {
            'model': 'sarvam-m',
            'messages': [
                {
                    'role': 'system',
                    'content': BLOCK_DIAGRAM_SYSTEM_PROMPT
                },
                {
                    'role': 'user',
                    'content': f"Generate a block diagram in Bridge Language for: {user_prompt}"
                }
            ],
            'temperature': 0.3,
            'max_tokens': 2048
        }

        response = requests.post(SARVAM_API_URL, headers=headers, json=payload, timeout=60)

        if response.status_code != 200:
            error_detail = response.text
            print(f"Sarvam API Error [{response.status_code}]: {error_detail}")
            return jsonify({
                'error': f'AI service returned status {response.status_code}',
                'detail': error_detail
            }), 502

        result = response.json()
        bridge_code = result['choices'][0]['message']['content'].strip()

        if bridge_code.startswith('```'):
            lines = bridge_code.split('\n')
            lines = [l for l in lines if not l.strip().startswith('```')]
            bridge_code = '\n'.join(lines).strip()

        return jsonify({
            'success': True,
            'bridge_code': bridge_code,
            'usage': result.get('usage', {})
        })

    except requests.exceptions.Timeout:
        return jsonify({'error': 'The AI service timed out. Please try again.'}), 504
    except requests.exceptions.ConnectionError:
        return jsonify({'error': 'Could not connect to the AI service.'}), 503
    except Exception as e:
        print(f"Server error: {str(e)}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/api/refine-block', methods=['POST'])
def refine_block_diagram():
    """
    Takes existing Bridge Language code for a block diagram and a refinement instruction,
    sends both to SarvamM to produce an updated version.
    """
    try:
        data = request.get_json()
        current_code = data.get('current_code', '')
        instruction = data.get('instruction', '')

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
                    'content': BLOCK_DIAGRAM_SYSTEM_PROMPT
                },
                {
                    'role': 'user',
                    'content': f"Here is my current block diagram code:\n{current_code}\n\nPlease modify it with this instruction: {instruction}\n\nOutput ONLY the complete updated Bridge Language code."
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

        if bridge_code.startswith('```'):
            lines = bridge_code.split('\n')
            lines = [l for l in lines if not l.strip().startswith('```')]
            bridge_code = '\n'.join(lines).strip()

        return jsonify({
            'success': True,
            'bridge_code': bridge_code,
            'usage': result.get('usage', {})
        })

    except Exception as e:
        print(f"Refine block diagram error: {str(e)}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500


@app.route('/api/refine', methods=['POST'])
def refine_flowchart():
    """
    Takes existing Bridge Language code and a refinement instruction,
    sends both to SarvamM to produce an updated version.
    """
    try:
        data = request.get_json()
        current_code = data.get('current_code', '')
        instruction = data.get('instruction', '')

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
                    'content': BRIDGE_LANGUAGE_SYSTEM_PROMPT
                },
                {
                    'role': 'user',
                    'content': f"Here is my current flowchart code:\n{current_code}\n\nPlease modify it with this instruction: {instruction}\n\nOutput ONLY the complete updated Bridge Language code."
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

        # Clean up markdown fencing
        if bridge_code.startswith('```'):
            lines = bridge_code.split('\n')
            lines = [l for l in lines if not l.strip().startswith('```')]
            bridge_code = '\n'.join(lines).strip()

        return jsonify({
            'success': True,
            'bridge_code': bridge_code,
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
