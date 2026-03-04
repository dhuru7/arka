"""Vercel Serverless Function for /api/send-emails"""
from http.server import BaseHTTPRequestHandler
import json
import os

try:
    import requests
except ImportError:
    import urllib.request
    import urllib.error

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "").strip('"\'  ')
ADMIN_SECRET = os.getenv("ADMIN_SECRET", "arka-dhruv-2026")


def _send_via_resend(to_email, subject, html_body):
    """Send a single email via Resend API. Returns (success: bool, error: str|None)."""
    import requests as req
    resp = req.post(
        'https://api.resend.com/emails',
        headers={
            'Authorization': f'Bearer {RESEND_API_KEY}',
            'Content-Type': 'application/json'
        },
        json={
            'from': 'Arka Team <onboarding@resend.dev>',
            'to': [to_email],
            'subject': subject,
            'html': html_body
        },
        timeout=30
    )
    if resp.status_code in (200, 201):
        return True, None
    else:
        return False, resp.text


def _send_batch_via_resend(emails, subject, html_body):
    """Send batch of emails via Resend batch API. Max 100 per call."""
    import requests as req
    batch_payload = []
    for email in emails:
        batch_payload.append({
            'from': 'Arka Team <onboarding@resend.dev>',
            'to': [email],
            'subject': subject,
            'html': html_body
        })

    resp = req.post(
        'https://api.resend.com/emails/batch',
        headers={
            'Authorization': f'Bearer {RESEND_API_KEY}',
            'Content-Type': 'application/json'
        },
        json=batch_payload,
        timeout=60
    )
    return resp.status_code, resp.text


class handler(BaseHTTPRequestHandler):
    def _json(self, status, data):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_POST(self):
        try:
            if not RESEND_API_KEY:
                self._json(500, {"error": "RESEND_API_KEY not configured. Set it in Vercel environment variables."})
                return

            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)

            emails = data.get('emails', [])
            subject = data.get('subject', '')
            html_body = data.get('html', '')
            admin_key = data.get('admin_key', '')

            # Admin verification
            if admin_key != ADMIN_SECRET:
                self._json(403, {"error": "Unauthorized. Invalid admin key."})
                return

            if not emails or not subject or not html_body:
                self._json(400, {"error": "Missing emails, subject, or html body."})
                return

            # Filter out empty/invalid emails
            valid_emails = [e.strip() for e in emails if e and '@' in e and '.' in e]

            if not valid_emails:
                self._json(400, {"error": "No valid email addresses found."})
                return

            # Send in batches of 50 (Resend batch limit is 100)
            total_sent = 0
            total_failed = 0
            all_errors = []

            # Try batch API first for efficiency
            batch_size = 50
            for i in range(0, len(valid_emails), batch_size):
                batch = valid_emails[i:i + batch_size]
                try:
                    status_code, resp_text = _send_batch_via_resend(batch, subject, html_body)
                    if status_code in (200, 201):
                        total_sent += len(batch)
                    else:
                        # If batch fails, try one-by-one as fallback
                        for email in batch:
                            try:
                                success, err = _send_via_resend(email, subject, html_body)
                                if success:
                                    total_sent += 1
                                else:
                                    total_failed += 1
                                    all_errors.append(f"{email}: {err}")
                            except Exception as e:
                                total_failed += 1
                                all_errors.append(f"{email}: {str(e)}")
                except Exception as e:
                    # Batch failed entirely, try one-by-one
                    for email in batch:
                        try:
                            success, err = _send_via_resend(email, subject, html_body)
                            if success:
                                total_sent += 1
                            else:
                                total_failed += 1
                                all_errors.append(f"{email}: {err}")
                        except Exception as e2:
                            total_failed += 1
                            all_errors.append(f"{email}: {str(e2)}")

            self._json(200, {
                "success": True,
                "sent": total_sent,
                "failed": total_failed,
                "total": len(valid_emails),
                "errors": all_errors[:10]
            })

        except Exception as e:
            self._json(500, {"error": f"Server error: {str(e)}"})

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
