/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Arka – Main Application Logic
 *  Handles UI interactions, API calls, Firebase, and orchestration.
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ── Firebase Config ─────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBxYkOQFnSuVEFZBOBnMbtB3OBBt0IgVuA",
    authDomain: "flowcraft-gen.firebaseapp.com",
    projectId: "flowcraft-gen",
    storageBucket: "flowcraft-gen.firebasestorage.app",
    databaseURL: "https://flowcraft-gen-default-rtdb.firebaseio.com"
};

// ── DOM Elements ────────────────────────────────────────────────────────────
const promptInput = document.getElementById('prompt-input');
const generateBtn = document.getElementById('generate-btn');
const codeEditor = document.getElementById('code-editor');
const canvasEl = document.getElementById('flowchart-canvas');
const emptyState = document.getElementById('empty-state');
const zoomLevelEl = document.getElementById('zoom-level');
const statusText = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');
const nodeCountEl = document.getElementById('node-count');
const edgeCountEl = document.getElementById('edge-count');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebar = document.getElementById('sidebar');
const refineInput = document.getElementById('refine-input');
const refineBtn = document.getElementById('refine-btn');

// ── Instances ───────────────────────────────────────────────────────────────
const parser = new BridgeParser();
const renderer = new FlowchartRenderer(canvasEl);

// ── State ───────────────────────────────────────────────────────────────────
let currentBridgeCode = '';
let db = null; // Firebase Realtime DB reference

// ═══ Initialization ═════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    initFirebase();
    setupEventListeners();
    updateStatus('ready', 'Ready');
});

// ── Firebase Init ───────────────────────────────────────────────────────────
function initFirebase() {
    try {
        if (typeof firebase !== 'undefined') {
            firebase.initializeApp(FIREBASE_CONFIG);
            db = firebase.database();
            console.log('Firebase initialized');
        } else {
            console.warn('Firebase SDK not loaded — save/load disabled');
        }
    } catch (e) {
        console.warn('Firebase init error:', e.message);
    }
}

// ═══ Event Listeners ════════════════════════════════════════════════════════

function setupEventListeners() {
    // Generate button
    generateBtn.addEventListener('click', handleGenerate);

    // Enter key in prompt (Ctrl+Enter)
    promptInput.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault();
            handleGenerate();
        }
    });

    // Live code editor → preview
    if (codeEditor) {
        codeEditor.addEventListener('input', debounce(() => {
            currentBridgeCode = codeEditor.value;
            renderFromCode(currentBridgeCode);
        }, 500));
    }

    // Zoom controls
    document.getElementById('zoom-in').addEventListener('click', () => {
        renderer.zoomIn();
    });
    document.getElementById('zoom-out').addEventListener('click', () => {
        renderer.zoomOut();
    });
    document.getElementById('zoom-fit').addEventListener('click', () => {
        renderer.fitToScreen();
    });

    // Zoom level display
    canvasEl.addEventListener('zoomchange', (e) => {
        zoomLevelEl.textContent = Math.round(e.detail.scale * 100) + '%';
    });

    // Node edit from Canvas
    canvasEl.addEventListener('nodeedit', (e) => {
        const { node, oldText, newText } = e.detail;
        if (!currentBridgeCode) return;

        // Find the node's raw code in the text editor and replace it
        const newRaw = node.raw.replace(oldText, newText);
        currentBridgeCode = currentBridgeCode.replace(node.raw, newRaw);
        if (codeEditor) {
            codeEditor.value = currentBridgeCode;
        }

        // Update the node's raw reference directly so future edits work without requiring a full manual re-parse
        node.raw = newRaw;
    });

    // Toolbar buttons
    document.getElementById('btn-export-png').addEventListener('click', handleExportPNG);
    document.getElementById('btn-export-svg').addEventListener('click', handleExportSVG);
    document.getElementById('btn-save').addEventListener('click', () => openModal('save-modal'));
    document.getElementById('btn-load').addEventListener('click', handleOpenLoad);

    // Code actions
    const btnCopyCode = document.getElementById('btn-copy-code');
    if (btnCopyCode) btnCopyCode.addEventListener('click', handleCopyCode);
    const btnClearCode = document.getElementById('btn-clear-code');
    if (btnClearCode) btnClearCode.addEventListener('click', handleClearCode);
    const btnClearCanvas = document.getElementById('btn-clear-canvas');
    if (btnClearCanvas) btnClearCanvas.addEventListener('click', handleClearCode);

    // Sidebar toggle (mobile)
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
    });

    // Example chips
    document.querySelectorAll('.example-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            promptInput.value = chip.dataset.prompt;
            promptInput.focus();
        });
    });

    // Refine
    refineBtn.addEventListener('click', handleRefine);
    refineInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleRefine();
        }
    });

    // Modal close
    document.querySelectorAll('.modal-close, .modal-cancel').forEach(el => {
        el.addEventListener('click', () => {
            document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
        });
    });

    // Save confirm
    document.getElementById('save-confirm').addEventListener('click', handleSave);
}

// ═══ Core: Generate Flowchart ═══════════════════════════════════════════════

async function handleGenerate() {
    const prompt = promptInput.value.trim();
    if (!prompt) {
        showToast('Please describe the flowchart you want to create.', 'error');
        return;
    }

    generateBtn.classList.add('loading');
    generateBtn.disabled = true;
    updateStatus('loading', 'Generating...');

    try {
        const response = await fetch('http://127.0.0.1:5000/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Generation failed');
        }

        currentBridgeCode = data.bridge_code;
        if (codeEditor) codeEditor.value = currentBridgeCode;
        renderFromCode(currentBridgeCode);
        updateStatus('ready', 'Generated');
        showToast('Flowchart generated successfully!', 'success');

    } catch (err) {
        console.error('Generate error:', err);
        updateStatus('error', 'Error');
        showToast(err.message, 'error');
    } finally {
        generateBtn.classList.remove('loading');
        generateBtn.disabled = false;
    }
}

// ═══ Core: Refine Flowchart ═════════════════════════════════════════════════

async function handleRefine() {
    const instruction = refineInput.value.trim();
    if (!instruction) {
        showToast('Enter a refinement instruction.', 'error');
        return;
    }
    if (!currentBridgeCode) {
        showToast('Generate a flowchart first.', 'error');
        return;
    }

    refineBtn.disabled = true;
    refineBtn.textContent = 'Refining...';
    updateStatus('loading', 'Refining...');

    try {
        const response = await fetch('http://127.0.0.1:5000/api/refine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_code: currentBridgeCode, instruction })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Refinement failed');

        currentBridgeCode = data.bridge_code;
        if (codeEditor) codeEditor.value = currentBridgeCode;
        renderFromCode(currentBridgeCode);
        refineInput.value = '';
        updateStatus('ready', 'Refined');
        showToast('Flowchart refined!', 'success');

    } catch (err) {
        showToast(err.message, 'error');
        updateStatus('error', 'Error');
    } finally {
        refineBtn.disabled = false;
        refineBtn.textContent = '✨ Refine';
    }
}

// ═══ Render Bridge Code ═════════════════════════════════════════════════════

function renderFromCode(code) {
    if (!code || !code.trim()) {
        emptyState.style.display = 'block';
        canvasEl.style.display = 'none';
        const ctx = canvasEl.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        nodeCountEl.textContent = 'NODES: 0';
        if (edgeCountEl) edgeCountEl.textContent = 'EDGES: 0';
        return;
    }

    try {
        const parsed = parser.parse(code);

        if (parsed.nodes.length === 0) {
            emptyState.style.display = 'block';
            canvasEl.style.display = 'none';
            showToast('No valid blocks found in the code.', 'error');
            return;
        }

        emptyState.style.display = 'none';
        canvasEl.style.display = 'block';
        renderer.render(parsed);

        nodeCountEl.textContent = 'NODES: ' + parsed.nodes.length;
        if (edgeCountEl) edgeCountEl.textContent = 'EDGES: ' + parsed.edges.length;
        zoomLevelEl.textContent = Math.round(renderer.scale * 100) + '%';

    } catch (err) {
        console.error('Parse/render error:', err);
        showToast('Error parsing the Bridge Language code.', 'error');
    }
}

// ═══ Export Functions ════════════════════════════════════════════════════════

function handleExportPNG() {
    if (!currentBridgeCode) {
        showToast('Generate a flowchart first.', 'error');
        return;
    }

    const dataUrl = renderer.exportPNG();
    const link = document.createElement('a');
    link.download = 'flowchart.png';
    link.href = dataUrl;
    link.click();
    showToast('PNG exported!', 'success');
}

function handleExportSVG() {
    if (!currentBridgeCode) {
        showToast('Generate a flowchart first.', 'error');
        return;
    }

    const svgContent = renderer.exportSVG();
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = 'flowchart.svg';
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    showToast('SVG exported!', 'success');
}

// ═══ Code Actions ═══════════════════════════════════════════════════════════

function handleCopyCode() {
    if (!currentBridgeCode) {
        showToast('Nothing to copy.', 'error');
        return;
    }
    navigator.clipboard.writeText(currentBridgeCode).then(() => {
        showToast('Code copied to clipboard!', 'success');
    });
}

function handleClearCode() {
    if (codeEditor) codeEditor.value = '';
    if (promptInput) promptInput.value = '';
    currentBridgeCode = '';
    emptyState.style.display = 'block';
    canvasEl.style.display = 'none';
    const ctx = canvasEl.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    nodeCountEl.textContent = 'NODES: 0';
    if (edgeCountEl) edgeCountEl.textContent = 'EDGES: 0';
    updateStatus('ready', 'Ready');
}

// ═══ Firebase Save & Load ═══════════════════════════════════════════════════

function handleSave() {
    const nameInput = document.getElementById('save-name');
    const name = nameInput.value.trim();

    if (!name) {
        showToast('Enter a name for the flowchart.', 'error');
        return;
    }
    if (!currentBridgeCode) {
        showToast('Generate a flowchart first.', 'error');
        return;
    }
    if (!db) {
        showToast('Firebase not initialized.', 'error');
        return;
    }

    const flowchartData = {
        name,
        code: currentBridgeCode,
        prompt: promptInput.value,
        createdAt: Date.now()
    };

    const newRef = db.ref('flowcharts').push();
    newRef.set(flowchartData)
        .then(() => {
            showToast(`Saved "${name}" successfully!`, 'success');
            closeAllModals();
            nameInput.value = '';
        })
        .catch(err => {
            showToast('Save failed: ' + err.message, 'error');
        });
}

function handleOpenLoad() {
    if (!db) {
        showToast('Firebase not initialized.', 'error');
        return;
    }

    openModal('load-modal');
    const listEl = document.getElementById('saved-list');
    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">Loading...</div>';

    db.ref('flowcharts').orderByChild('createdAt').limitToLast(20).once('value')
        .then(snapshot => {
            const items = [];
            snapshot.forEach(child => {
                items.push({ id: child.key, ...child.val() });
            });
            items.reverse();

            if (items.length === 0) {
                listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">No saved flowcharts.</div>';
                return;
            }

            listEl.innerHTML = '';
            items.forEach(item => {
                const div = document.createElement('div');
                div.className = 'saved-item';
                div.innerHTML = `
                    <div>
                        <div class="saved-item-name">${escapeHtml(item.name)}</div>
                        <div class="saved-item-date">${new Date(item.createdAt).toLocaleDateString()}</div>
                    </div>
                    <div class="saved-item-actions">
                        <button class="saved-item-btn load-item" data-id="${item.id}">Load</button>
                        <button class="saved-item-btn delete" data-id="${item.id}">✕</button>
                    </div>
                `;
                listEl.appendChild(div);
            });

            // Attach load handlers
            listEl.querySelectorAll('.load-item').forEach(btn => {
                btn.addEventListener('click', () => loadFlowchart(btn.dataset.id));
            });

            listEl.querySelectorAll('.delete').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteFlowchart(btn.dataset.id);
                });
            });
        })
        .catch(err => {
            listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--error);">Error: ${err.message}</div>`;
        });
}

function loadFlowchart(id) {
    db.ref('flowcharts/' + id).once('value')
        .then(snapshot => {
            const data = snapshot.val();
            if (data) {
                currentBridgeCode = data.code;
                if (codeEditor) codeEditor.value = currentBridgeCode;
                promptInput.value = data.prompt || '';
                renderFromCode(currentBridgeCode);
                closeAllModals();
                showToast(`Loaded "${data.name}"`, 'success');
            }
        });
}

function deleteFlowchart(id) {
    if (confirm('Delete this flowchart?')) {
        db.ref('flowcharts/' + id).remove()
            .then(() => {
                showToast('Deleted.', 'info');
                handleOpenLoad(); // Refresh list
            });
    }
}

// ═══ UI Helpers ══════════════════════════════════════════════════════════════

function updateStatus(state, text) {
    statusDot.className = 'status-dot ' + (state === 'loading' ? 'loading' : state === 'error' ? 'error' : '');
    statusText.textContent = text;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    toast.innerHTML = `<span>${icon}</span> ${escapeHtml(message)}`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function openModal(id) {
    document.getElementById(id).classList.add('active');
}

function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function debounce(fn, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}
