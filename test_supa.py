import requests
url = 'https://api.supadata.ai/v1/transcript?url=https://www.youtube.com/watch?v=jNQXAC9IVRw&text=true'
headers = {'x-api-key': 'sd_14a060fc8a6b311244d92b1661d00fe5'}
try:
    res = requests.get(url, headers=headers)
    print(res.status_code)
    print(res.json())
except Exception as e:
    print(e)
