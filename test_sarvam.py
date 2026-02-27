"""Test with the FULL law system prompt to see if that's what causes failures"""
import requests
import json
import time

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

headers = {
    'Content-Type': 'application/json',
    'api-subscription-key': SARVAM_API_KEY
}

long_prompt = "there's a website named ORA policy and i purchased a 1 year warrenty for my laptop from there and i had a discount code and i entered it there and it showed 35 rupees as the discounted price after the discount code and i payed 35 rupees now i don't have the warrenty plan and the coustmer care is saying i needa pay full price for the warenty can i take it to the consumer court tho they are saying that i can get 35 rupees as refund but i want the warrenty plan"

payload = {
    'model': 'sarvam-m',
    'messages': [
        {'role': 'system', 'content': LAW_SYSTEM_PROMPT},
        {'role': 'user', 'content': long_prompt}
    ],
    'temperature': 0.3,
    'max_tokens': 2048
}

print("=" * 60)
print("TEST: Full system prompt + long user message")
print(f"System prompt length: {len(LAW_SYSTEM_PROMPT)} chars")
print(f"User prompt length: {len(long_prompt)} chars")
print("=" * 60)

results = []
for attempt in range(5):
    print(f"\nAttempt {attempt + 1}/5...")
    start = time.time()
    try:
        response = requests.post(SARVAM_API_URL, headers=headers, json=payload, timeout=90)
        elapsed = time.time() - start
        body = response.text
        print(f"  Status: {response.status_code} | Time: {elapsed:.1f}s | Body length: {len(body)}")
        
        if not body:
            results.append(f"Attempt {attempt+1}: EMPTY RESPONSE (status {response.status_code})")
            print(f"  >>> EMPTY RESPONSE <<<")
        elif response.status_code == 200:
            result = json.loads(body)
            content = result.get('choices', [{}])[0].get('message', {}).get('content', '')
            if not content:
                results.append(f"Attempt {attempt+1}: Empty content in choices")
                print(f"  >>> EMPTY CONTENT IN CHOICES <<<")
                print(f"  Keys: {list(result.keys())}")
            else:
                results.append(f"Attempt {attempt+1}: OK ({len(content)} chars)")
                print(f"  Content (first 200 chars): {content[:200]}")
        else:
            results.append(f"Attempt {attempt+1}: HTTP {response.status_code}")
            print(f"  Error body: {body[:300]}")
    except Exception as e:
        elapsed = time.time() - start
        results.append(f"Attempt {attempt+1}: {type(e).__name__}")
        print(f"  Error ({elapsed:.1f}s): {type(e).__name__}: {e}")
    
    time.sleep(1)

print("\n" + "=" * 60)
print("SUMMARY:")
print("=" * 60)
for r in results:
    print(f"  {r}")
