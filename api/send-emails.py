"""Vercel Serverless Function for /api/send-emails"""
from http.server import BaseHTTPRequestHandler
import json
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

ADMIN_SECRET = os.getenv("ADMIN_SECRET", "arka-dhruv-2026")
GMAIL_ADDRESS = os.getenv("GMAIL_ADDRESS", "")
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "")

def _send_via_gmail(to_emails, subject, html_body):
    """Send emails via Gmail SMTP using BCC."""
    if not GMAIL_ADDRESS or not GMAIL_APP_PASSWORD:
        return False, "GMAIL_ADDRESS or GMAIL_APP_PASSWORD not configured.", 0, len(to_emails)

    try:
        server = smtplib.SMTP_SSL('smtp.gmail.com', 465)
        server.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
        
        # Batch into 50 Bcc max per send to avoid spam flags
        batch_size = 50
        total_sent = 0
        all_errors = []
        
        for i in range(0, len(to_emails), batch_size):
            batch = to_emails[i:i + batch_size]
            try:
                msg = MIMEMultipart('alternative')
                msg['Subject'] = subject
                msg['From'] = f"Arka Team <{GMAIL_ADDRESS}>"
                msg['To'] = GMAIL_ADDRESS # Primary 'to' address
                msg['Bcc'] = ", ".join(batch)
                
                part = MIMEText(html_body, 'html')
                msg.attach(part)
                
                server.sendmail(GMAIL_ADDRESS, [GMAIL_ADDRESS] + batch, msg.as_string())
                total_sent += len(batch)
            except Exception as e:
                all_errors.append(f"Batch failed: {str(e)}")
        
        server.quit()
        
        if total_sent == 0:
            return False, f"Failed to send any batches. Errors: {'; '.join(all_errors)}", 0, len(to_emails)
            
        success = total_sent == len(to_emails)
        return success, ", ".join(all_errors), total_sent, len(to_emails) - total_sent
        
    except Exception as e:
        return False, f"SMTP Connection Error: {str(e)}", 0, len(to_emails)

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

            if admin_key != ADMIN_SECRET:
                self._json(403, {"error": "Unauthorized. Invalid admin key."})
                return

            if not GMAIL_ADDRESS or not GMAIL_APP_PASSWORD:
                self._json(500, {"error": "GMAIL_ADDRESS or GMAIL_APP_PASSWORD not configured. Please set them in Vercel."})
                return

            if not emails or not subject or not html_body:
                self._json(400, {"error": "Missing emails, subject, or html body."})
                return

            valid_emails = [e.strip() for e in emails if e and '@' in e and '.' in e]

            if not valid_emails:
                self._json(400, {"error": "No valid email addresses found."})
                return

            success, err, sent, failed = _send_via_gmail(valid_emails, subject, html_body)
            
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
