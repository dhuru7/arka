import requests
import json

c = """%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
graph TD
A[Node]"""

payload = {
    'mode': 'architecture',
    'instruction': 'add node B',
    'current_code': c
}

try:
    res = requests.post('http://127.0.0.1:5000/api/refine', json=payload)
    print(res.status_code)
    print(res.text)
except Exception as e:
    print(e)
