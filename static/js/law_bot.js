/**
 * Arka - Legal AI Assistant (v2 – Chat + Card Flow)
 * Interactive Q&A with option cards, "Others" freetext, and final result cards.
 */

let chatHistory = [];
let questionCount = 0;

document.addEventListener('DOMContentLoaded', () => {

    const sendBtn = document.getElementById('send-btn');
    const inputArea = document.getElementById('law-prompt-input');
    const chatScroll = document.getElementById('law-chat-scroll');
    const welcomeEl = document.getElementById('law-welcome');
    const newChatBtn = document.getElementById('new-chat-btn');
    const sidebarNewChatBtn = document.getElementById('sidebar-new-chat-btn');

    // UI Elements for Sidebar & Profile
    const sidebarToggle = document.getElementById('law-sidebar-toggle');
    const sidebar = document.getElementById('law-sidebar');
    const mobileOverlay = document.getElementById('law-mobile-overlay');
    const profileBtn = document.getElementById('btn-profile');
    const profileMenu = document.getElementById('profile-dropdown-menu');
    const historyList = document.getElementById('law-history-list');

    let currentSessionId = Date.now().toString();
    let currentUser = null;

    // ── Deep-Link Handling (for Admin Context) ──────────────────────────────
    const urlParams = new URLSearchParams(window.location.search);
    const targetUid = urlParams.get('uid');
    const targetSid = urlParams.get('sid');

    async function loadDeepLink(uid, sid) {
        try {
            const snap = await firebase.database().ref(`law_chats/${uid}/${sid}`).once('value');
            const sessionData = snap.val();
            if (sessionData) {
                console.log("[LawBot] Loading shared session:", sid);
                loadSpecificSession(sid, sessionData);
            } else {
                showToast("Chat session not found.", "error");
            }
        } catch (e) {
            console.error("[LawBot] Deep link error:", e);
            showToast("Unauthorized or invalid session.", "error");
        }
    }

    const loginModal = document.getElementById('login-modal');
    const googleLoginBtn = document.getElementById('btn-google-login');

    googleLoginBtn?.addEventListener('click', async () => {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            googleLoginBtn.disabled = true;
            googleLoginBtn.innerHTML = `<span>SIGNING IN...</span>`;
            await firebase.auth().signInWithPopup(provider);
            // onAuthStateChanged will handle the rest
            loginModal.classList.remove('active');
        } catch (error) {
            console.error("Login failed:", error);
            showToast("Login failed. Please try again.", "error");
            googleLoginBtn.disabled = false;
            googleLoginBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 18 18" style="margin-right: 12px;">
                    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"></path>
                    <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"></path>
                    <path d="M3.964 10.71a5.41 5.41 0 010-3.42V4.958H.957a8.991 8.991 0 000 8.083l3.007-2.331z" fill="#FBBC05"></path>
                    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"></path>
                </svg>
                <span>SIGN UP WITH GOOGLE</span>
            `;
        }
    });

    // Wrap initialization to separate normal load vs deep link
    firebase.auth().onAuthStateChanged(async (user) => {
        if (user && !user.isAnonymous) {
            currentUser = user;
            document.getElementById('user-display-name').innerText = user.displayName || user.email;
            document.getElementById('user-email').innerText = user.email;
            loginModal.classList.remove('active');

            if (targetUid && targetSid) {
                await loadDeepLink(targetUid, targetSid);
            } else {
                loadChatHistory();
            }
        } else {
            loginModal.classList.add('active');
        }
    });

    document.getElementById('btn-logout')?.addEventListener('click', () => {
        firebase.auth().signOut().then(() => window.location.href = '/');
    });

    // ── UI Toggle Logic ────────────────────────────────────────────────────
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        sidebarToggle.classList.toggle('active');
        mobileOverlay.classList.toggle('active');
    });

    mobileOverlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        sidebarToggle.classList.remove('active');
        mobileOverlay.classList.remove('active');
    });

    profileBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        profileMenu.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#profile-dropdown-wrapper')) {
            profileMenu.classList.remove('active');
        }
    });

    // ── Auto-resize textarea ──────────────────────────────────────────────
    inputArea.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 150) + 'px';
    });

    // ── Enter to send ─────────────────────────────────────────────────────
    inputArea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    sendBtn.addEventListener('click', handleSend);

    // ── Welcome chip quick-starts ─────────────────────────────────────────
    document.querySelectorAll('.law-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const prompt = chip.getAttribute('data-prompt');
            inputArea.value = prompt;
            handleSend();
        });
    });

    // ── New Chat ──────────────────────────────────────────────────────────
    function startNewChat() {
        chatHistory = [];
        questionCount = 0;
        currentSessionId = Date.now().toString();
        // Remove all messages (keep welcome)
        const msgs = chatScroll.querySelectorAll('.law-msg');
        msgs.forEach(m => m.remove());
        // Show welcome again
        if (welcomeEl) {
            welcomeEl.style.display = '';
        }
        inputArea.value = '';
        inputArea.style.height = 'auto';
        inputArea.focus();

        // Close sidebar on mobile
        sidebar.classList.remove('open');
        sidebarToggle.classList.remove('active');
        mobileOverlay.classList.remove('active');
    }

    newChatBtn.addEventListener('click', startNewChat);
    sidebarNewChatBtn?.addEventListener('click', startNewChat);

    // ── Build API URL (auto-detects environment) ─────────────────────────
    function getApiUrl(path) {
        const host = window.location.hostname;
        const port = window.location.port;

        // Running Flask directly (port 5000)
        if (port === '5000') {
            return path;
        }
        // Running Live Server locally (localhost or 127.0.0.1) on any other port
        if (host === 'localhost' || host === '127.0.0.1') {
            return 'http://127.0.0.1:5000' + path;
        }
        // Running on Vercel or custom production domains
        return path;
    }

    // ── Fetch with retry (handles empty responses and JSON parse errors) ──
    async function fetchWithRetry(url, options, maxRetries = 2) {
        let lastError;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`[LawBot] API attempt ${attempt}/${maxRetries} → ${url}`);

                // 150-second timeout to allow backend retries (up to ~90s each) to complete
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 150000);
                const fetchOptions = { ...options, signal: controller.signal };

                const response = await fetch(url, fetchOptions);
                clearTimeout(timeoutId);

                console.log(`[LawBot] Response status: ${response.status}`);

                // Read body as text first to avoid JSON parse error on empty body
                const responseText = await response.text();
                console.log(`[LawBot] Response body length: ${responseText.length}`);

                if (!responseText || responseText.trim() === '') {
                    console.warn(`[LawBot] Empty response body on attempt ${attempt}`);
                    if (attempt < maxRetries) {
                        const waitMs = 3000 * attempt; // 3s, 6s
                        console.log(`[LawBot] Retrying in ${waitMs}ms...`);
                        await new Promise(r => setTimeout(r, waitMs));
                        continue;
                    }
                    throw new Error('Server returned an empty response. Please try again.');
                }

                // Safely parse JSON
                let data;
                try {
                    data = JSON.parse(responseText);
                } catch (parseErr) {
                    console.warn(`[LawBot] JSON parse error on attempt ${attempt}:`, parseErr.message);
                    console.warn(`[LawBot] Raw response (first 500 chars):`, responseText.substring(0, 500));
                    if (attempt < maxRetries) {
                        const waitMs = 3000 * attempt;
                        console.log(`[LawBot] Retrying in ${waitMs}ms...`);
                        await new Promise(r => setTimeout(r, waitMs));
                        continue;
                    }
                    throw new Error('Server returned an invalid response. Please try again.');
                }

                return data;

            } catch (err) {
                lastError = err;
                if (err.name === 'AbortError') {
                    console.warn(`[LawBot] Request timed out on attempt ${attempt}`);
                    lastError = new Error('Request timed out. The AI service may be busy — please try again.');
                } else {
                    console.warn(`[LawBot] Attempt ${attempt} failed:`, err.message);
                }
                if (attempt < maxRetries) {
                    const waitMs = 3000 * attempt;
                    console.log(`[LawBot] Retrying in ${waitMs}ms...`);
                    await new Promise(r => setTimeout(r, waitMs));
                }
            }
        }
        throw lastError;
    }

    // ── Handle Send ───────────────────────────────────────────────────────
    async function handleSend(optionTextOrEvent) {
        if (!currentUser) {
            showToast("You must be logged in.", "error");
            return;
        }

        const text = (typeof optionTextOrEvent === 'string') ? optionTextOrEvent : inputArea.value.trim();
        if (!text) return;

        // Hide welcome
        if (welcomeEl) {
            welcomeEl.style.display = 'none';
        }

        // Reset input
        if (typeof optionTextOrEvent !== 'string') {
            inputArea.value = '';
            inputArea.style.height = 'auto';
        }

        // Append user bubble
        appendUserMsg(text);
        chatHistory.push({ role: 'user', content: text });

        // Loading
        sendBtn.classList.add('loading');
        sendBtn.disabled = true;
        const loaderId = appendLoadingMsg();

        try {
            const apiUrl = getApiUrl('/api/law-chat');
            // fetchWithRetry now returns parsed JSON data directly
            const data = await fetchWithRetry(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: text,
                    history: chatHistory.slice(-14)
                })
            });

            removeLoadingMsg(loaderId);

            if (data.success) {
                let parsed = data.response;

                // Safety net: if parsed has no phase but message looks like JSON, try re-parsing
                if (!parsed.phase && parsed.message && parsed.message.trim().startsWith('{')) {
                    try {
                        const reParsed = JSON.parse(parsed.message);
                        if (reParsed.phase) {
                            console.log('[LawBot] Re-parsed JSON from message field');
                            parsed = reParsed;
                        }
                    } catch (e) {
                        // Also try extracting JSON from within the text
                        const jsonMatch = parsed.message.match(/\{[\s\S]*"phase"\s*:\s*"(final|questioning)"[\s\S]*\}/);
                        if (jsonMatch) {
                            try {
                                const extracted = JSON.parse(jsonMatch[0]);
                                if (extracted.phase) {
                                    console.log('[LawBot] Extracted JSON from message text');
                                    parsed = extracted;
                                }
                            } catch (e2) { /* ignore */ }
                        }
                    }
                }

                chatHistory.push({ role: 'assistant', content: JSON.stringify(parsed) });

                if (parsed.phase === 'final') {
                    renderFinalCards(parsed.cards);
                    // Ask for feedback after final response
                    setTimeout(showFeedbackModal, 2000);
                } else if (parsed.phase === 'questioning') {
                    questionCount++;
                    renderQuestionMsg(parsed);
                } else {
                    // Fallback: treat as plain text
                    const msg = parsed.message || JSON.stringify(parsed);
                    renderPlainAIMsg(msg);
                }

                // Save session to Firebase
                saveChatSession();
            } else {
                showToast(data.error || 'Failed to get response', 'error');
                renderPlainAIMsg('⚠️ ' + (data.error || 'Something went wrong.'));
            }
        } catch (err) {
            console.error('[LawBot] All retries failed:', err);
            removeLoadingMsg(loaderId);
            showToast('Connection issue — retrying didn\'t help.', 'error');
            renderPlainAIMsg('⚠️ ' + err.message);
        } finally {
            sendBtn.classList.remove('loading');
            sendBtn.disabled = false;
        }
    }

    // ── Append User Message ───────────────────────────────────────────────
    function appendUserMsg(text) {
        const wrap = el('div', 'law-msg law-msg-user');
        wrap.innerHTML = `
            <div class="law-msg-avatar">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                </svg>
            </div>
            <div class="law-msg-body">
                <div class="law-msg-bubble">${escapeHTML(text)}</div>
            </div>
        `;
        chatScroll.appendChild(wrap);
        scrollBottom();
    }

    // ── Render Question Message ───────────────────────────────────────────
    function renderQuestionMsg(data) {
        const wrap = el('div', 'law-msg law-msg-ai');

        let bubbleContent = '';
        if (data.message) {
            bubbleContent = parseMd(data.message);
        }

        let questionHTML = '';
        if (data.question) {
            questionHTML = `
                <div class="law-question-section">
                    <div class="law-question-label">Question ${questionCount}</div>
                    <div class="law-question-text">${escapeHTML(data.question)}</div>
                    <div class="law-options-grid" id="options-${Date.now()}">
                        ${(data.options || []).filter(opt => !/^others?\b/i.test(opt.trim())).map((opt, i) => `
                            <button class="law-option-card" data-option="${escapeAttr(opt)}">
                                <span class="law-option-num">${String.fromCharCode(65 + i)}</span>
                                <span class="law-option-label">${escapeHTML(opt)}</span>
                            </button>
                        `).join('')}
                        <button class="law-option-card law-others-card" data-option="__others__">
                            <span class="law-option-num">✎</span>
                            <span class="law-option-label">Others (describe your situation)</span>
                        </button>
                    </div>
                </div>
            `;
        }

        wrap.innerHTML = `
            <div class="law-msg-avatar">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
            </div>
            <div class="law-msg-body">
                ${bubbleContent ? `<div class="law-msg-bubble">${bubbleContent}</div>` : ''}
                ${questionHTML}
            </div>
        `;

        chatScroll.appendChild(wrap);

        // Bind option clicks
        const grid = wrap.querySelector('.law-options-grid');
        if (grid) {
            const cards = grid.querySelectorAll('.law-option-card');
            cards.forEach(card => {
                card.addEventListener('click', () => {
                    const optVal = card.getAttribute('data-option');

                    if (optVal === '__others__') {
                        // Show text input for custom answer
                        expandOthers(grid, cards);
                    } else {
                        // Mark selected, disable all, send
                        cards.forEach(c => c.style.pointerEvents = 'none');
                        card.classList.add('selected');
                        handleSend(optVal);
                    }
                });
            });
        }

        scrollBottom();
    }

    // ── Expand "Others" input ─────────────────────────────────────────────
    function expandOthers(grid, allCards) {
        // Disable all cards
        allCards.forEach(c => {
            if (!c.classList.contains('law-others-card')) {
                c.style.opacity = '0.4';
                c.style.pointerEvents = 'none';
            }
        });
        // Mark "Others" as selected
        const othersCard = grid.querySelector('.law-others-card');
        othersCard.classList.add('selected');
        othersCard.style.pointerEvents = 'none';

        // Create expand row
        const expandRow = el('div', 'law-others-expand');
        expandRow.innerHTML = `
            <input type="text" class="law-others-input" placeholder="Describe your specific situation..." autofocus>
            <button class="law-others-send">Send</button>
        `;
        grid.appendChild(expandRow);

        const inp = expandRow.querySelector('.law-others-input');
        const sendOthers = expandRow.querySelector('.law-others-send');

        inp.focus();
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                submitOthers();
            }
        });
        sendOthers.addEventListener('click', submitOthers);

        function submitOthers() {
            const val = inp.value.trim();
            if (!val) return;
            inp.disabled = true;
            sendOthers.disabled = true;
            handleSend(val);
        }

        scrollBottom();
    }

    // ── Render Final Cards ────────────────────────────────────────────────
    function renderFinalCards(cards) {
        const wrap = el('div', 'law-msg law-msg-ai');

        const cardDefs = [
            { key: 'issue_summary', emoji: '📋', label: 'Issue Summary', iconClass: 'summary' },
            { key: 'legal_classification', emoji: '⚖️', label: 'Legal Classification', iconClass: 'classification' },
            { key: 'applicable_laws', emoji: '📜', label: 'Applicable Laws & Sections', iconClass: 'laws' },
            { key: 'risk_urgency', emoji: '🚨', label: 'Risk & Urgency', iconClass: 'risk' },
            { key: 'official_resources', emoji: '🏛️', label: 'Official Resources & Help', iconClass: 'resources' },
            { key: 'action_plan', emoji: '📝', label: 'Immediate Action Plan', iconClass: 'action' },
            { key: 'required_documents', emoji: '📁', label: 'Required Documents', iconClass: 'documents' },
            { key: 'preventive_advice', emoji: '🛡️', label: 'Preventive Advice', iconClass: 'preventive' },
        ];

        let cardsHTML = '';
        for (const def of cardDefs) {
            const value = cards[def.key];
            if (!value || (typeof value === 'string' && !value.trim())) continue;

            let bodyHTML = '';

            if (def.key === 'risk_urgency' && typeof value === 'object' && !Array.isArray(value)) {
                const level = (value.level || 'MEDIUM').toUpperCase();
                const levelClass = level === 'HIGH' ? 'high' : level === 'LOW' ? 'low' : 'medium';
                bodyHTML = `
                    <div class="law-risk-badge ${levelClass}">
                        <span class="law-risk-badge-dot"></span>
                        ${level} URGENCY
                    </div>
                    <div>${parseMd(value.description || '')}</div>
                `;
            } else if (Array.isArray(value)) {
                // Render arrays as a clean bulleted list
                bodyHTML = '<ul style="margin:0;padding-left:1.2em;">' +
                    value.map(item => `<li>${parseMd(String(item))}</li>`).join('') +
                    '</ul>';
            } else if (typeof value === 'object' && value !== null) {
                // Render other objects as key-value pairs
                bodyHTML = Object.entries(value)
                    .map(([k, v]) => `<p><strong>${escapeHTML(k)}:</strong> ${parseMd(String(v))}</p>`)
                    .join('');
            } else {
                bodyHTML = parseMd(String(value));
            }

            cardsHTML += `
                <div class="law-result-card">
                    <div class="law-card-header">
                        <div class="law-card-icon ${def.iconClass}">${def.emoji}</div>
                        <div class="law-card-title">${def.label}</div>
                    </div>
                    <div class="law-card-body">${bodyHTML}</div>
                </div>
            `;
        }

        wrap.innerHTML = `
            <div class="law-msg-avatar">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
            </div>
            <div class="law-msg-body">
                <div class="law-msg-bubble">
                    <h3>✅ Legal Analysis Complete</h3>
                    <p>Based on the information you've provided, here is your comprehensive legal guidance:</p>
                </div>
                <div class="law-final-cards">
                    ${cardsHTML}
                </div>
            </div>
        `;

        chatScroll.appendChild(wrap);
        scrollBottom();
    }

    // ── Render Plain AI Message ───────────────────────────────────────────
    function renderPlainAIMsg(text) {
        const wrap = el('div', 'law-msg law-msg-ai');
        wrap.innerHTML = `
            <div class="law-msg-avatar">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
            </div>
            <div class="law-msg-body">
                <div class="law-msg-bubble">${parseMd(text)}</div>
            </div>
        `;
        chatScroll.appendChild(wrap);
        scrollBottom();
    }

    // ── Loading Message ───────────────────────────────────────────────────
    function appendLoadingMsg() {
        const id = 'loader-' + Date.now();
        const wrap = el('div', 'law-msg law-msg-ai law-msg-loading');
        wrap.id = id;
        wrap.innerHTML = `
            <div class="law-msg-avatar">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
            </div>
            <div class="law-msg-body">
                <div class="law-msg-bubble">
                    <div class="law-typing-dots">
                        <span class="law-typing-dot"></span>
                        <span class="law-typing-dot"></span>
                        <span class="law-typing-dot"></span>
                    </div>
                    <span class="law-loading-text">Analyzing legal patterns...</span>
                </div>
            </div>
        `;
        chatScroll.appendChild(wrap);
        scrollBottom();
        return id;
    }

    function removeLoadingMsg(id) {
        const loader = document.getElementById(id);
        if (loader) loader.remove();
    }

    // ── Utilities ─────────────────────────────────────────────────────────
    function scrollBottom() {
        requestAnimationFrame(() => {
            chatScroll.scrollTop = chatScroll.scrollHeight;
        });
    }

    function el(tag, className) {
        const e = document.createElement(tag);
        if (className) e.className = className;
        return e;
    }

    function escapeHTML(str) {
        return str.replace(/[&<>'"]/g,
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag)
        );
    }

    function escapeAttr(str) {
        return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function parseMd(text) {
        if (typeof marked !== 'undefined') {
            return marked.parse(text);
        }
        return `<p>${escapeHTML(text).replace(/\n/g, '<br>')}</p>`;
    }

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    // ── Firebase Storage & History ─────────────────────────────────────────

    async function saveChatSession() {
        if (!currentUser || chatHistory.length === 0) return;

        const path = `law_chats/${currentUser.uid}/${currentSessionId}`;
        const summary = chatHistory[0].content.substring(0, 50) + "...";

        try {
            await firebase.database().ref(path).set({
                history: chatHistory,
                lastUpdated: firebase.database.ServerValue.TIMESTAMP,
                title: summary,
                userName: currentUser.displayName || currentUser.email
            });
            loadChatHistory();
        } catch (e) {
            console.error("Error saving chat:", e);
        }
    }

    async function loadChatHistory() {
        if (!currentUser) return;
        const ref = firebase.database().ref(`law_chats/${currentUser.uid}`);
        ref.off(); // avoid multiple listeners
        ref.on('value', (snap) => {
            const data = snap.val();
            if (!data) {
                historyList.innerHTML = '<div class="law-history-empty">No conversations yet</div>';
                return;
            }

            const items = Object.entries(data).sort((a, b) => b[1].lastUpdated - a[1].lastUpdated);
            historyList.innerHTML = items.map(([id, chat]) => `
                <div class="law-history-item ${id === currentSessionId ? 'active' : ''}" data-id="${id}">
                    <div class="law-history-item-title">${escapeHTML(chat.title || 'Legal Chat')}</div>
                    <div class="law-history-item-date">${new Date(chat.lastUpdated).toLocaleDateString()}</div>
                </div>
            `).join('');

            historyList.querySelectorAll('.law-history-item').forEach(item => {
                item.addEventListener('click', () => {
                    const sid = item.getAttribute('data-id');
                    loadSpecificSession(sid, data[sid]);
                });
            });
        });
    }

    function loadSpecificSession(sessionId, sessionData) {
        currentSessionId = sessionId;
        chatHistory = sessionData.history || [];

        // Clear and render all messages
        const msgs = chatScroll.querySelectorAll('.law-msg');
        msgs.forEach(m => m.remove());
        if (welcomeEl) welcomeEl.style.display = 'none';

        chatHistory.forEach(msg => {
            if (msg.role === 'user') {
                appendUserMsg(msg.content);
            } else {
                try {
                    const parsed = JSON.parse(msg.content);
                    if (parsed.phase === 'final') {
                        renderFinalCards(parsed.cards);
                    } else if (parsed.phase === 'questioning') {
                        renderQuestionMsg(parsed);
                    } else {
                        renderPlainAIMsg(parsed.message || msg.content);
                    }
                } catch (e) {
                    renderPlainAIMsg(msg.content);
                }
            }
        });

        // Close sidebar on mobile
        sidebar.classList.remove('open');
        sidebarToggle.classList.remove('active');
        mobileOverlay.classList.remove('active');

        scrollBottom();
    }

    // ── Feedback System ────────────────────────────────────────────────────
    const feedbackModal = document.getElementById('feedback-modal');
    let feedbackData = { correctness: null, rating: null };

    function showFeedbackModal() {
        feedbackModal.classList.add('active');
        // Reset state
        feedbackData = { correctness: null, rating: null };
        document.getElementById('feedback-comments').value = '';
        document.querySelectorAll('.feedback-correctness, .law-rating-btn').forEach(btn => btn.classList.remove('active'));
    }

    document.querySelectorAll('.feedback-correctness').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.feedback-correctness').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            feedbackData.correctness = btn.getAttribute('data-value');
        });
    });

    document.querySelectorAll('.law-rating-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.law-rating-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            feedbackData.rating = btn.getAttribute('data-value');
        });
    });

    document.getElementById('btn-cancel-feedback').addEventListener('click', () => {
        feedbackModal.classList.remove('active');
    });

    document.getElementById('btn-submit-feedback').addEventListener('click', async () => {
        const comments = document.getElementById('feedback-comments').value.trim();

        if (!feedbackData.correctness || !feedbackData.rating) {
            showToast("Please provide correctness and rating.", "warning");
            return;
        }

        const path = `law_feedback/${currentUser.uid}/${currentSessionId}`;
        try {
            await firebase.database().ref(path).set({
                correctness: feedbackData.correctness,
                rating: parseInt(feedbackData.rating),
                comments: comments,
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                userName: currentUser.displayName || currentUser.email,
                chatSnippet: chatHistory.length > 0 ? chatHistory[0].content : ""
            });
            showToast("Feedback submitted. Thank you!", "success");
            feedbackModal.classList.remove('active');
        } catch (e) {
            showToast("Error submitting feedback.", "error");
        }
    });
});
