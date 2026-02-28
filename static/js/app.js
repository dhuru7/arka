/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Arka – Main Application Logic v3.0 (Mermaid JS)
 *  Handles UI interactions, API calls, Firebase, 
 *  and Mermaid orchestration.
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
const canvasContainer = document.getElementById('canvas-container');
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

// ── State ───────────────────────────────────────────────────────────────
let currentMermaidCode = '';
let db = null; // Firebase Realtime DB reference
let currentMode = 'flowchart'; // 'flowchart' or 'block'
let currentScale = 1;

// ═══ Initialization ═════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    initFirebase();
    mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
    setupEventListeners();
    setupModeToggle();
    updateStatus('ready', 'Ready');

    // Hide property panel since we don't use it for mermaid
    document.getElementById('properties-panel').style.display = 'none';

    // Disable unneeded toolbars
    document.getElementById('btn-undo').disabled = true;
    document.getElementById('btn-redo').disabled = true;
    document.getElementById('btn-delete-selected').disabled = true;
    document.getElementById('btn-edit-text').disabled = true;
    document.getElementById('btn-auto-layout').disabled = true;
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

    // Zoom controls
    document.getElementById('zoom-in').addEventListener('click', () => {
        currentScale += 0.1;
        applyZoom();
    });
    document.getElementById('zoom-out').addEventListener('click', () => {
        currentScale = Math.max(0.1, currentScale - 0.1);
        applyZoom();
    });
    document.getElementById('zoom-fit').addEventListener('click', () => {
        currentScale = 1;
        applyZoom();
    });

    // Toolbar buttons — download dropdown
    setupDownloadDropdown();
    document.getElementById('btn-export-svg').addEventListener('click', () => { closeDownloadDropdown(); handleExportSVG(); });
    // Disable PNG and JSON export as they require canvas rendering logic
    document.getElementById('btn-export-png').style.display = 'none';
    document.getElementById('btn-export-json').style.display = 'none';

    // Code viewer
    document.getElementById('btn-code-view').addEventListener('click', handleOpenCodeEditor);
    document.getElementById('code-editor-apply').addEventListener('click', handleApplyCodeEdit);

    document.getElementById('btn-save').addEventListener('click', () => openModal('save-modal'));
    document.getElementById('btn-load').addEventListener('click', handleOpenLoad);

    // Clear canvas
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

function applyZoom() {
    zoomLevelEl.textContent = Math.round(currentScale * 100) + '%';
    const svgEl = canvasContainer.querySelector('svg');
    if (svgEl) {
        svgEl.style.transform = `scale(${currentScale})`;
        svgEl.style.transformOrigin = 'center center';
        svgEl.style.transition = 'transform 0.2s';
    }
}

// ═══ Mode Toggle ════════════════════════════════════════════════════════════

function setupModeToggle() {
    const modeFlowchartBtn = document.getElementById('mode-flowchart');
    const modeBlockBtn = document.getElementById('mode-block');
    const indicator = document.getElementById('mode-indicator');

    modeFlowchartBtn.addEventListener('click', () => switchMode('flowchart'));
    modeBlockBtn.addEventListener('click', () => switchMode('block'));
}

function switchMode(mode) {
    if (mode === currentMode) return;
    currentMode = mode;

    const modeFlowchartBtn = document.getElementById('mode-flowchart');
    const modeBlockBtn = document.getElementById('mode-block');
    const indicator = document.getElementById('mode-indicator');
    const subtitleText = document.getElementById('subtitle-text');
    const promptLabel = document.getElementById('prompt-label');
    const generateBtnText = document.getElementById('generate-btn-text');
    const emptyIcon = document.getElementById('empty-icon');
    const emptyTitle = document.getElementById('empty-title');
    const emptyDesc = document.getElementById('empty-desc');
    const examplesFlowchart = document.getElementById('examples-flowchart');
    const examplesBlock = document.getElementById('examples-block');

    if (mode === 'block') {
        modeFlowchartBtn.classList.remove('active');
        modeBlockBtn.classList.add('active');
        indicator.classList.add('right');

        subtitleText.textContent = 'AI Block Diagram Generator';
        promptLabel.textContent = 'Describe your system';
        generateBtnText.textContent = 'Generate Block Diagram';
        promptInput.placeholder = 'e.g. A microservice architecture...';
        emptyIcon.textContent = '[ □ ]';
        emptyTitle.textContent = 'AWAITING SYSTEM DESCRIPTION';
        emptyDesc.textContent = 'Describe your system architecture in the sidebar to generate a block diagram.';
        examplesFlowchart.style.display = 'none';
        examplesBlock.style.display = 'block';
    } else {
        modeBlockBtn.classList.remove('active');
        modeFlowchartBtn.classList.add('active');
        indicator.classList.remove('right');

        subtitleText.textContent = 'AI Flowchart Generator';
        promptLabel.textContent = 'Describe your flow';
        generateBtnText.textContent = 'Generate Flowchart';
        promptInput.placeholder = 'e.g. A user login flow...';
        emptyIcon.textContent = '[ ]';
        emptyTitle.textContent = 'AWAITING PROMPT';
        emptyDesc.textContent = 'Describe what you need in the sidebar to initialize rendering.';
        examplesFlowchart.style.display = 'block';
        examplesBlock.style.display = 'none';
    }

    bindExampleChips();

    currentMermaidCode = '';
    showEmptyState();
    updateStatus('ready', 'Ready');

    showToast(`Switched to ${mode === 'block' ? 'Block Diagram' : 'Flowchart'} mode`, 'info');
}

function bindExampleChips() {
    document.querySelectorAll('.example-chip').forEach(chip => {
        const newChip = chip.cloneNode(true);
        chip.parentNode.replaceChild(newChip, chip);
        newChip.addEventListener('click', () => {
            promptInput.value = newChip.dataset.prompt;
            promptInput.focus();
        });
    });
}

// ═══ Core: Generate Flowchart ═══════════════════════════════════════════════

async function handleGenerate() {
    const prompt = promptInput.value.trim();
    if (!prompt) {
        showToast(`Please describe the ${currentMode === 'block' ? 'block diagram' : 'flowchart'} you want to create.`, 'error');
        return;
    }

    generateBtn.classList.add('loading');
    generateBtn.disabled = true;
    updateStatus('loading', 'Generating...');

    const generateEndpoint = currentMode === 'block'
        ? 'http://127.0.0.1:5000/api/generate-block'
        : 'http://127.0.0.1:5000/api/generate';

    try {
        const response = await fetch(generateEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Generation failed');
        }

        currentMermaidCode = data.code;
        await renderFromCode(currentMermaidCode);
        updateStatus('ready', 'Generated');
        showToast(`${currentMode === 'block' ? 'Block diagram' : 'Flowchart'} generated successfully!`, 'success');

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
    if (!currentMermaidCode) {
        showToast(`Generate a ${currentMode === 'block' ? 'block diagram' : 'flowchart'} first.`, 'error');
        return;
    }

    refineBtn.disabled = true;
    refineBtn.textContent = 'Refining...';
    updateStatus('loading', 'Refining...');

    const refineEndpoint = currentMode === 'block'
        ? 'http://127.0.0.1:5000/api/refine-block'
        : 'http://127.0.0.1:5000/api/refine';

    try {
        const response = await fetch(refineEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_code: currentMermaidCode, instruction })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Refinement failed');

        currentMermaidCode = data.code;
        await renderFromCode(currentMermaidCode);
        refineInput.value = '';
        updateStatus('ready', 'Refined');
        showToast(`${currentMode === 'block' ? 'Block diagram' : 'Flowchart'} refined!`, 'success');

    } catch (err) {
        showToast(err.message, 'error');
        updateStatus('error', 'Error');
    } finally {
        refineBtn.disabled = false;
        refineBtn.textContent = 'Refine';
    }
}

// ═══ Render Mermaid Code ═════════════════════════════════════════════════════

function showEmptyState() {
    canvasContainer.innerHTML = '';
    canvasContainer.appendChild(emptyState);
    emptyState.style.display = 'block';
    nodeCountEl.textContent = 'NODES: 0';
    edgeCountEl.textContent = 'EDGES: 0';
}

async function renderFromCode(code) {
    if (!code || !code.trim()) {
        showEmptyState();
        return;
    }

    try {
        const { svg } = await mermaid.render('mermaid-svg-graph', code);
        canvasContainer.innerHTML = svg;
        canvasContainer.appendChild(emptyState); // Re-append it so it's not destroyed
        emptyState.style.display = 'none';

        // Count rough metrics
        const matchesNodes = code.match(/\[|\]|\(|\)|\{|\}/g);
        const matchesEdges = code.match(/--|==|-\.>|-->|==>|\.-/g);
        nodeCountEl.textContent = 'NODES: ' + (matchesNodes ? Math.floor(matchesNodes.length / 2) : '?');
        edgeCountEl.textContent = 'EDGES: ' + (matchesEdges ? matchesEdges.length : '?');

        currentScale = 1;
        applyZoom();

    } catch (err) {
        console.error('Parse/render error:', err);
        showToast('Error parsing the Mermaid code: ' + err.message, 'error');
    }
}

// ═══ Export Functions ════════════════════════════════════════════════════════

function handleExportSVG() {
    const exportType = currentMode === 'block' ? 'block-diagram' : 'flowchart';
    if (!currentMermaidCode) {
        showToast(`Generate a ${currentMode === 'block' ? 'block diagram' : 'flowchart'} first.`, 'error');
        return;
    }

    const svgEl = canvasContainer.querySelector('svg');
    if (!svgEl) return;

    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `${exportType}.svg`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
    showToast('SVG exported!', 'success');
}

// ═══ Code Actions ═══════════════════════════════════════════════════════════

function handleClearCode() {
    if (promptInput) promptInput.value = '';
    currentMermaidCode = '';
    showEmptyState();
    updateStatus('ready', 'Ready');
}

// ═══ Download Dropdown ══════════════════════════════════════════════════════

function setupDownloadDropdown() {
    const btn = document.getElementById('btn-download');
    const menu = document.getElementById('download-dropdown-menu');

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#download-dropdown-wrapper')) {
            menu.classList.remove('active');
        }
    });
}

function closeDownloadDropdown() {
    const menu = document.getElementById('download-dropdown-menu');
    if (menu) menu.classList.remove('active');
}

// ═══ Code Editor ════════════════════════════════════════════════════════════

function handleOpenCodeEditor() {
    const textarea = document.getElementById('code-editor-textarea');
    textarea.value = currentMermaidCode || '';
    openModal('code-editor-modal');

    if (!textarea._liveHandler) {
        textarea._liveHandler = debounce(() => {
            const code = textarea.value.trim();
            if (code) {
                currentMermaidCode = code;
                renderFromCode(currentMermaidCode);
            }
        }, 600);
        textarea.addEventListener('input', textarea._liveHandler);
    }
}

async function handleApplyCodeEdit() {
    const textarea = document.getElementById('code-editor-textarea');
    const code = textarea.value.trim();
    if (!code) {
        showToast('Code is empty.', 'error');
        return;
    }
    currentMermaidCode = code;
    await renderFromCode(currentMermaidCode);
    closeAllModals();
    showToast('Code applied to diagram!', 'success');
}

// ═══ Firebase Save & Load ═══════════════════════════════════════════════════

function handleSave() {
    const nameInput = document.getElementById('save-name');
    const name = nameInput.value.trim();

    if (!name) {
        showToast(`Enter a name for the ${currentMode === 'block' ? 'block diagram' : 'flowchart'}.`, 'error');
        return;
    }
    if (!currentMermaidCode) {
        showToast(`Generate a ${currentMode === 'block' ? 'block diagram' : 'flowchart'} first.`, 'error');
        return;
    }
    if (!db) {
        showToast('Firebase not initialized.', 'error');
        return;
    }

    const flowchartData = {
        name,
        code: currentMermaidCode,
        prompt: promptInput.value,
        mode: currentMode,
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
                        <button class="saved-item-btn delete" data-id="${item.id}">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                `;
                listEl.appendChild(div);
            });

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
                if (data.mode && data.mode !== currentMode) {
                    switchMode(data.mode);
                }
                currentMermaidCode = data.code;
                promptInput.value = data.prompt || '';
                renderFromCode(currentMermaidCode);
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
                handleOpenLoad();
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

    let iconSvg = '';
    if (type === 'success') {
        iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    } else if (type === 'error') {
        iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
    } else {
        iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    }

    toast.innerHTML = `<span class="toast-icon">${iconSvg}</span> ${escapeHtml(message)}`;
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
