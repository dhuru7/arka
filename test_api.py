import requests

url = "https://api.sarvam.ai/v1/chat/completions"
headers = {
    "api-subscription-key": "sk_h10vkdry_WChEvgrtvbYb4iQPe1hNVmWT",
    "Content-Type": "application/json"
}
payload = {
    "model": "sarvam-m",
    "messages": [{"role": "user", "content": "hello"}]
}

r = requests.post(url, headers=headers, json=payload)
with open("api_res.txt", "w") as f:
    f.write(f"Status: {r.status_code}\nText: {r.text}")
