import requests

def test():
    with open('d:/project_arka/test_res.txt', 'w') as f:
        try:
            r = requests.post(
                'http://127.0.0.1:5000/api/yt-notes',
                json={'url': 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'},
                timeout=5
            )
            f.write(f"Status Code: {r.status_code}\n")
            f.write(f"Response: {r.text}\n")
        except Exception as e:
            f.write(f"Request Error: {e}\n")

if __name__ == '__main__':
    test()
