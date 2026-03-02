import os
import requests

api_key = "sk_h10vkdry_WChEvgrtvbYb4iQPe1hNVmWT"
url = "https://api.sarvam.ai/v1/chat/completions"

headers = {
    "api-subscription-key": api_key,
    "Content-Type": "application/json"
}

payload = {
    "model": "sarvam-m",
    "messages": [
        {"role": "user", "content": "hi"}
    ]
}

res = requests.post(url, headers=headers, json=payload, timeout=5)
print(res.status_code)
print(res.text)
