/**
 * Arka - Legal AI Assistant Scripts
 */

let chatHistory = [];

document.addEventListener('DOMContentLoaded', () => {

    const sendBtn = document.getElementById('send-btn');
    const inputArea = document.getElementById('law-prompt-input');
    const chatWindow = document.getElementById('chat-window');

    // Auto-resize textarea
    inputArea.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if (this.scrollHeight > 200) {
            this.style.overflowY = 'auto';
        } else {
            this.style.overflowY = 'hidden';
        }
    });

    // Enter to send (Shift+Enter for newline)
    inputArea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    sendBtn.addEventListener('click', handleSend);

    // Sidebar quick examples
    const exampleChips = document.querySelectorAll('.example-chip');
    exampleChips.forEach(chip => {
        chip.addEventListener('click', () => {
            const prompt = chip.getAttribute('data-prompt');
            inputArea.value = prompt;
            inputArea.style.height = 'auto';
            inputArea.style.height = (inputArea.scrollHeight) + 'px';
            inputArea.focus();
        });
    });

    // Mobile Sidebar toggle
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });
    }

    // Process Message
    async function handleSend() {
        const text = inputArea.value.trim();
        if (!text) return;

        // Reset UI
        inputArea.value = '';
        inputArea.style.height = '60px';
        inputArea.focus();
        if (window.innerWidth <= 768 && sidebar) {
            sidebar.classList.remove('open');
        }

        appendUserMessage(text);

        chatHistory.push({ role: 'user', content: text });

        // Show loading state
        sendBtn.classList.add('loading');
        sendBtn.disabled = true;
        const loaderId = appendLoadingMessage();

        try {
            const response = await fetch('http://127.0.0.1:5000/api/law-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: text,
                    history: chatHistory.slice(-10) // Keep last 10 messages for context
                })
            });

            const data = await response.json();

            removeLoadingMessage(loaderId);

            if (data.success) {
                const aiMessage = data.response.message || "I couldn't generate a clear response.";
                const aiQuestions = data.response.questions || [];

                chatHistory.push({ role: 'assistant', content: aiMessage });

                appendAIMessage(aiMessage, aiQuestions);
            } else {
                showToast(data.error || 'Failed to get response', 'error');
                appendAIMessage("Error: " + (data.error || "Something went wrong."), []);
            }
        } catch (error) {
            console.error("Chat Error:", error);
            removeLoadingMessage(loaderId);
            showToast('Server connection failed.', 'error');
            appendAIMessage("Connection Error. Please try again.", []);
        } finally {
            sendBtn.classList.remove('loading');
            sendBtn.disabled = false;
        }
    }

    function appendUserMessage(text) {
        const wrap = document.createElement('div');
        wrap.className = 'message user-message';
        wrap.innerHTML = `<div class="message-content">${escapeHTML(text)}</div>`;
        chatWindow.appendChild(wrap);
        scrollToBottom();
    }

    function appendAIMessage(markdownText, questions) {
        const wrap = document.createElement('div');
        wrap.className = 'message ai-message';

        // Parse markdown 
        let parsedHtml = '';
        if (typeof marked !== 'undefined') {
            parsedHtml = marked.parse(markdownText);
        } else {
            parsedHtml = `<p>${escapeHTML(markdownText).replace(/\n/g, '<br>')}</p>`;
        }

        let contentObj = document.createElement('div');
        contentObj.className = 'message-content';
        contentObj.innerHTML = parsedHtml;
        wrap.appendChild(contentObj);

        // Add questions as cards
        if (questions && questions.length > 0) {
            const grid = document.createElement('div');
            grid.className = 'question-cards';

            questions.forEach(q => {
                const card = document.createElement('button');
                card.className = 'q-card';
                card.innerHTML = `
                    <span>${escapeHTML(q)}</span>
                    <svg class="q-card-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                        <polyline points="12 5 19 12 12 19"></polyline>
                    </svg>
                `;

                // When clicked, append question to input or send directly
                card.addEventListener('click', () => {
                    const currentVal = inputArea.value.trim();
                    if (currentVal) {
                        inputArea.value = currentVal + '\n\nRegarding: ' + q + '\n';
                    } else {
                        inputArea.value = 'Regarding: ' + q + '\n';
                    }
                    inputArea.focus();
                    inputArea.style.height = 'auto';
                    inputArea.style.height = (inputArea.scrollHeight) + 'px';
                });

                grid.appendChild(card);
            });
            wrap.appendChild(grid);
        }

        chatWindow.appendChild(wrap);
        scrollToBottom();
    }

    function appendLoadingMessage() {
        const id = 'loader-' + Date.now();
        const wrap = document.createElement('div');
        wrap.className = 'message ai-message loading-message';
        wrap.id = id;
        wrap.innerHTML = `
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <span style="font-size: 0.8rem; margin-left: 8px;">Analyzing legal patterns...</span>
        `;
        chatWindow.appendChild(wrap);
        scrollToBottom();
        return id;
    }

    function removeLoadingMessage(id) {
        const el = document.getElementById(id);
        if (el) {
            el.remove();
        }
    }

    function scrollToBottom() {
        chatWindow.scrollTop = chatWindow.scrollHeight;
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

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.style.borderColor = type === 'error' ? 'var(--accent)' : 'var(--border-light)';
        toast.textContent = message;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
});
