import requests, urllib.parse
tex_code = r'''\documentclass{article}
\begin{document}
Hello World!
\end{document}
'''
try:
    url = "https://latexonline.cc/compile?text=" + urllib.parse.quote(tex_code)
    r = requests.get(url)
    print("Status:", r.status_code)
    print("Headers:", r.headers.get("Content-Type"))
except Exception as e:
    print(e)
