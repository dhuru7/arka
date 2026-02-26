import urllib.request
import json

url = "http://127.0.0.1:5000/api/law-chat"
headers = {"Content-Type": "application/json"}
data = json.dumps({"prompt": "test prompt", "history": [{"role": "user", "content": "test prompt"}]}).encode("utf-8")

req = urllib.request.Request(url, data=data, headers=headers)
try:
    with urllib.request.urlopen(req) as response:
        print("Status:", response.status)
        print("Body:", response.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print("HTTP Error:", e.code)
    print("Error Body:", e.read().decode('utf-8'))
except urllib.error.URLError as e:
    print("URL Error:", e.reason)
