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

Here is the Bridge Language syntax:

BLOCK TYPES:
1. Terminator Start:  ts()      (defaults to "Start")
2. Terminator End:    te()      (defaults to "End")
3. General Terminator: t("text")
4. Process (Action):  p["text"]
5. Decision:          d<"text">
6. Input/Output:      l["text"]
7. Connector:         c[)
8. Multi-Sub-Block:   B{ *tm: "text" *tl: "text" *tr: "text" *bm: "text" *bl: "text" *br: "text" }

(Quotes can be single, double, triple-single, or triple-double)

ARROWS & CONNECTIONS:
1. Forward Arrow:           a>
2. Backward Arrow:          a<
3. Labeled Arrow:           a*label text*>
4. Loop/Jump Arrow:         node_code_herea>!target_code_here
   (e.g., p["Step 2"]a>!ts() to jump back to start)
5. Branching (Restating Nodes):
   To branch from a decision node, simply restate the decision node, add a labeled arrow, and continue the path.
   (e.g.,
    d<"Question">
    a*Yes*>
    p["Do this"]
    ...
    d<"Question">
    a*No*>
    p["Do that"]
   )

CODE STRUCTURE & FORMATTING RULES (STRICT TWO-PHASE FORMAT):
Phase 1: Declaration Phase 
- First, list ALL unique blocks used in the flowchart, one block per line.
- Do NOT use any arrows here.

Separator:
- EXACTLY 5 dots on a new line: .....

Phase 2: Structure & Connection Phase
- Start at `ts()` and trace down your primary path.
- EVERY connection MUST be defined by an arrow. Never list consecutive nodes without an arrow (`a>`) between them.
- To create a new branch from a previous decision, simply restate that decision block, write the arrow, and continue!

IMPORTANT RULES:
- The declaration phase (Phase 1) MUST contain every node. 
- Phase 2 MUST EXACTLY match the text of nodes declared in Phase 1.
- Output ONLY the Bridge Language code, nothing else. No markdown fences.

EXAMPLE FLOWCHART (Notice how the decision block is restated to branch):
ts()
p["Initialize Process"]
d<"Is it valid?">
p["Process Data"]
p["Fix Errors"]
te()
.....
ts()
a>
p["Initialize Process"]
a>
d<"Is it valid?">
a*Yes*>
p["Process Data"]
a>
te()
d<"Is it valid?">
a*No*>
p["Fix Errors"]
a>
te()
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
