"""Vercel Serverless Function for /api/send-emails"""
from http.server import BaseHTTPRequestHandler
import json
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def _send_via_brevo(to_emails, subject, html_body, api_key, sender_email):
    """Send emails via Brevo API using BCC limit 50 per batch."""
    if not api_key or not sender_email:
        return False, "BREVO_API_KEY or BREVO_SENDER_EMAIL not configured.", 0, len(to_emails)

    try:
        import urllib.request
        import json
        
        url = "https://api.brevo.com/v3/smtp/email"
        batch_size = 50
        total_sent = 0
        all_errors = []
        
        for i in range(0, len(to_emails), batch_size):
            batch = to_emails[i:i + batch_size]
            data = {
                "sender": {"name": "Arka Team", "email": sender_email},
                "to": [{"email": sender_email}], # send primary to self
                "bcc": [{"email": e} for e in batch],
                "subject": subject,
                "htmlContent": html_body
            }
            
            req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'))
            req.add_header('api-key', api_key)
            req.add_header('accept', 'application/json')
            req.add_header('content-type', 'application/json')
            
            try:
                with urllib.request.urlopen(req) as response:
                    if response.getcode() in (200, 201, 202):
                        total_sent += len(batch)
                    else:
                        all_errors.append(f"HTTP {response.getcode()}")
            except Exception as e:
                err_body = str(e)
                if hasattr(e, 'read'):
                    try:
                        err_body = e.read().decode('utf-8')
                    except Exception:
                        pass
                all_errors.append(f"Batch failed: {err_body}")

        if total_sent == 0:
            return False, f"Failed: {'; '.join(all_errors)}", 0, len(to_emails)
            
        return total_sent == len(to_emails), ", ".join(all_errors), total_sent, len(to_emails) - total_sent
        
    except Exception as e:
        return False, f"Brevo API Error: {str(e)}", 0, len(to_emails)

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
            BREVO_API_KEY_ENV = os.getenv("BREVO_API_KEY", "").strip()
            BREVO_SENDER_EMAIL_ENV = os.getenv("BREVO_SENDER_EMAIL", "").strip()

            if admin_key != ADMIN_SECRET_ENV:
                self._json(403, {"error": "Unauthorized. Invalid admin key."})
                return

            if not BREVO_API_KEY_ENV or not BREVO_SENDER_EMAIL_ENV:
                self._json(500, {"error": "BREVO_API_KEY or BREVO_SENDER_EMAIL not configured! Please see settings tab instructions."})
                return

            if not emails or not subject or not html_body:
                self._json(400, {"error": "Missing emails, subject, or html body."})
                return

            valid_emails = [e.strip() for e in emails if e and '@' in e and '.' in e]

            if not valid_emails:
                self._json(400, {"error": "No valid email addresses found."})
                return

            success, err, sent, failed = _send_via_brevo(valid_emails, subject, html_body, BREVO_API_KEY_ENV, BREVO_SENDER_EMAIL_ENV)
            
            self._json(200, {
                "success": success,
                "sent": sent,
                "failed": failed,
                "total": len(valid_emails),
                "errors": [err] if err else []
            })

        except Exception as e:
            self._json(500, {"error": f"Server error: {str(e)}"})

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
