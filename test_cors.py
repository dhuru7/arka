import requests
try:
    r = requests.options('https://latexonline.cc/compile')
    print("OPTIONS headers:", r.headers)
    
    r2 = requests.post('https://latexonline.cc/compile', data={'text': '\\documentclass{article}\\begin{document}test\\end{document}'})
    print("POST headers:", r2.headers)
except Exception as e:
    print(e)
