from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
import requests
import json
import os

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
- a*label*>    → Labeled forward arrow
- a<           → Backward arrow
- a*label*<    → Labeled backward arrow

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

LOOPS (back-reference jumps):
p["Fix Errors"]a>!d<"Is valid?">

STRICT FORMATTING RULES:
1. Phase 1 (Declaration): List ALL unique blocks one per line. NO arrows. NO duplicates.
2. Separator: Exactly five dots on their own line: .....
3. Phase 2 (Connections): Connect blocks with arrows. EVERY pair of consecutive blocks MUST have an arrow (a> or a*label*>) between them. NEVER list two blocks on consecutive lines without an arrow between them.
4. Phase 2 text MUST EXACTLY match Phase 1 text character-for-character.
5. Output ONLY valid Bridge Language code. No markdown fences, no explanations, no comments.
6. Keep flowcharts clean: 4-10 blocks is ideal, avoid unnecessary complexity.
7. Every block in Phase 1 must appear at least once in Phase 2.
8. A decision block can appear multiple times in Phase 2 to create different branches.

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
p["Show error message"]a>!l["Enter credentials"]
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

Guidelines:
1. Suggest clear legal solutions and actionable steps the user can take.
2. Provide links to official online government websites for reporting or filing an FIR.
3. Reference past court or authority rulings related to the issue, if applicable.
4. If the issue is related to a university or institute, suggest checking their official rule books and UGC/AICTE guidelines.
5. Provide information only from official datasets/sources, keeping in mind that every state in India may have specific laws.
6. To understand the user's problem better, you MUST ask relevant questions. 
7. You MUST respond in the following JSON format ONLY:
{
  "message": "Your legal advice and explanation here (can contain markdown/html for formatting).",
  "questions": ["Question 1", "Question 2", ...]
}
Ensure the response is a valid JSON object. Do not add markdown fences like ```json.
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

        response = requests.post(SARVAM_API_URL, headers=headers, json=payload, timeout=60)

        if response.status_code != 200:
            error_detail = response.text
            print(f"Law Bot - Sarvam API Error [{response.status_code}]: {error_detail}")
            return jsonify({
                'error': f'AI service returned status {response.status_code}',
                'detail': error_detail
            }), 502

        result = response.json()
        law_response = result['choices'][0]['message']['content'].strip()

        # Clean up markdown fencing
        if law_response.startswith('```'):
            lines = law_response.split('\n')
            lines = [l for l in lines if not l.strip().startswith('```')]
            law_response = '\n'.join(lines).strip()

        # Try to parse the JSON
        try:
             parsed = json.loads(law_response)
        except json.JSONDecodeError:
             # Fallback if AI didn't return proper JSON
             parsed = {
                 "message": law_response,
                 "questions": []
             }

        return jsonify({
            'success': True,
            'response': parsed
        })

    except Exception as e:
        print(f"Law connect error: {str(e)}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)
