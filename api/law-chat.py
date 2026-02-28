"""Vercel Serverless Function for /api/law-chat"""
from http.server import BaseHTTPRequestHandler
import json
import requests
import re
import time

# ── Sarvam M API Configuration ──────────────────────────────────────────────
SARVAM_API_KEY = "sk_h10vkdry_WChEvgrtvbYb4iQPe1hNVmWT"
SARVAM_API_URL = "https://api.sarvam.ai/v1/chat/completions"

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


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)

            user_prompt = data.get('prompt', '')
            chat_history = data.get('history', [])

            if not user_prompt.strip():
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Please provide a message.'}).encode())
                return

            headers = {
                'Content-Type': 'application/json',
                'api-subscription-key': SARVAM_API_KEY
            }

            messages = [{'role': 'system', 'content': LAW_SYSTEM_PROMPT}]
            last_role = 'system'
            for msg in chat_history:
                role = 'user' if msg.get('role') == 'user' else 'assistant'
                content = msg.get('content', '')
                if not content:
                    continue
                if role == last_role:
                    messages[-1]['content'] += f"\n\n{content}"
                else:
                    messages.append({'role': role, 'content': content})
                last_role = role

            if last_role != 'user' or messages[-1]['content'].strip() != user_prompt.strip():
                messages.append({'role': 'user', 'content': user_prompt})

            payload = {
                'model': 'sarvam-m',
                'messages': messages,
                'temperature': 0.3,
                'max_tokens': 2048
            }

            MAX_RETRIES = 3
            law_response = None

            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    response = requests.post(SARVAM_API_URL, headers=headers, json=payload, timeout=90)

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

                    response_text = response.text.strip()
                    if not response_text:
                        if attempt < MAX_RETRIES:
                            time.sleep(2 ** attempt)
                            continue
                        self.send_response(502)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('Access-Control-Allow-Origin', '*')
                        self.end_headers()
                        self.wfile.write(json.dumps({'error': 'AI service returned empty response.'}).encode())
                        return

                    try:
                        result = json.loads(response_text)
                    except json.JSONDecodeError:
                        if attempt < MAX_RETRIES:
                            time.sleep(2 ** attempt)
                            continue
                        self.send_response(502)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('Access-Control-Allow-Origin', '*')
                        self.end_headers()
                        self.wfile.write(json.dumps({'error': 'AI service returned invalid response.'}).encode())
                        return

                    choices = result.get('choices', [])
                    if not choices or not choices[0].get('message', {}).get('content'):
                        if attempt < MAX_RETRIES:
                            time.sleep(2 ** attempt)
                            continue
                        self.send_response(502)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('Access-Control-Allow-Origin', '*')
                        self.end_headers()
                        self.wfile.write(json.dumps({'error': 'AI returned no content.'}).encode())
                        return

                    law_response = choices[0]['message']['content'].strip()
                    if law_response:
                        break

                except (requests.exceptions.Timeout, requests.exceptions.ConnectionError):
                    if attempt < MAX_RETRIES:
                        time.sleep(2 ** attempt)
                        continue
                    self.send_response(504)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({'error': 'AI service timed out.'}).encode())
                    return

            if not law_response:
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Failed to get response.'}).encode())
                return

            # Robust JSON extraction
            law_response = law_response.lstrip('\ufeff\u200b\u200c\u200d')
            law_response = re.sub(r'```(?:json|JSON)?\s*\n?', '', law_response).strip()

            parsed = None
            try:
                parsed = json.loads(law_response)
            except json.JSONDecodeError:
                pass

            if parsed is None:
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
                        except json.JSONDecodeError:
                            pass

            if parsed is None:
                parsed = {
                    "phase": "questioning",
                    "message": law_response,
                    "question": "",
                    "options": []
                }

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                'success': True,
                'response': parsed
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
