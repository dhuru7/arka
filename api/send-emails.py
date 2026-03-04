"""Vercel Serverless Function for /api/send-emails"""
from http.server import BaseHTTPRequestHandler
import json
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def _send_via_resend(to_emails, subject, html_body, api_key):
    """Send emails via Resend API."""
    if not api_key:
        return False, "RESEND_API_KEY not configured.", 0, len(to_emails)

    import urllib.request
    import json
    
    url = "https://api.resend.com/emails"
    sent = 0
    all_errors = []
    
    for email in to_emails:
        data = {
            "from": "Arka Team <onboarding@resend.dev>",
            "to": [email],
            "subject": subject,
            "html": html_body
        }
        
        req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'))
        req.add_header('Authorization', f'Bearer {api_key}')
        req.add_header('Content-Type', 'application/json')
        req.add_header('User-Agent', 'Mozilla/5.0')
        
        try:
            with urllib.request.urlopen(req) as response:
                if response.getcode() in (200, 201, 202):
                    sent += 1
                else:
                    all_errors.append(f"{email}: HTTP {response.getcode()}")
        except Exception as e:
            err_body = str(e)
            if hasattr(e, 'read'):
                try:
                    err_body = e.read().decode('utf-8')
                except Exception:
                    pass
            all_errors.append(f"{email}: {err_body}")

    if sent == 0:
        return False, f"Failed: {'; '.join(all_errors)}", 0, len(to_emails)
        
    return sent == len(to_emails), ", ".join(all_errors), sent, len(to_emails) - sent

class handler(BaseHTTPRequestHandler):
    def _json(self, status, data):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)

            emails = data.get('emails', [])
            subject = data.get('subject', '')
            html_body = data.get('html', '')
            admin_key = data.get('admin_key', '')

            ADMIN_SECRET_ENV = os.getenv("ADMIN_SECRET", "arka-dhruv-2026")
            RESEND_API_KEY_ENV = os.getenv("RESEND_API_KEY", "").strip()

            if admin_key != ADMIN_SECRET_ENV:
                self._json(403, {"error": "Unauthorized. Invalid admin key."})
                return

            if not RESEND_API_KEY_ENV:
                self._json(500, {"error": "RESEND_API_KEY not configured! Please see settings tab instructions."})
                return

            if not emails or not subject or not html_body:
                self._json(400, {"error": "Missing emails, subject, or html body."})
                return

            valid_emails = [e.strip() for e in emails if e and '@' in e and '.' in e]

            if not valid_emails:
                self._json(400, {"error": "No valid email addresses found."})
                return

            success, err, sent, failed = _send_via_resend(valid_emails, subject, html_body, RESEND_API_KEY_ENV)
            
            self._json(200, {
                "success": success,
                "sent": sent,
                "failed": failed,
                "total": len(valid_emails),
                "errors": [err] if err else [],
                "error": err if not success else None
            })

        except Exception as e:
            self._json(500, {"error": f"Server error: {str(e)}"})

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
