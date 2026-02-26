/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Arka – Main Application Logic v2.0
 *  Handles UI interactions, API calls, Firebase, properties panel,
 *  undo/redo, and orchestration.
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
const propsPanel = document.getElementById('properties-panel');
const propsContent = document.getElementById('prop-content');
const btnUndo = document.getElementById('btn-undo');
const btnRedo = document.getElementById('btn-redo');
const btnDeleteSelected = document.getElementById('btn-delete-selected');

// ── Instances ───────────────────────────────────────────────────────────────
const parser = new BridgeParser();
const renderer = new FlowchartRenderer(canvasContainer);

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

    // Zoom controls
    document.getElementById('zoom-in').addEventListener('click', () => renderer.zoomIn());
    document.getElementById('zoom-out').addEventListener('click', () => renderer.zoomOut());
    document.getElementById('zoom-fit').addEventListener('click', () => renderer.fitToScreen());

    // Zoom level display
    renderer.svg.addEventListener('zoomchange', (e) => {
        zoomLevelEl.textContent = Math.round(e.detail.scale * 100) + '%';
    });

    // Node edit from renderer
    renderer.svg.addEventListener('nodeedit', (e) => {
        const { node, oldText, newText } = e.detail;
        if (!currentBridgeCode) return;

        // Sync the bridge code
        const newRaw = node.raw.replace(oldText, newText);
        currentBridgeCode = currentBridgeCode.replace(node.raw, newRaw);
        node.raw = newRaw;
    });

    // Selection change → show/hide properties panel
    renderer.svg.addEventListener('selectionchange', (e) => {
        const { node, edge } = e.detail;
        if (node) {
            showNodeProperties(node);
            btnDeleteSelected.disabled = false;
        } else if (edge) {
            showEdgeProperties(edge);
            btnDeleteSelected.disabled = false;
        } else {
            hideProperties();
            btnDeleteSelected.disabled = true;
        }
    });

    // History state change → update undo/redo buttons
    renderer.svg.addEventListener('historystatechange', (e) => {
        btnUndo.disabled = !e.detail.canUndo;
        btnRedo.disabled = !e.detail.canRedo;
    });

    // Data change (node/edge deleted)
    renderer.svg.addEventListener('datachange', (e) => {
        nodeCountEl.textContent = 'NODES: ' + e.detail.nodes.length;
        edgeCountEl.textContent = 'EDGES: ' + e.detail.edges.length;
    });

    // Undo / Redo buttons
    btnUndo.addEventListener('click', () => renderer.undo());
    btnRedo.addEventListener('click', () => renderer.redo());

    // Delete selected
    btnDeleteSelected.addEventListener('click', () => {
        if (renderer.selectedNode) {
            renderer.deleteSelectedNode();
        } else if (renderer.selectedEdge) {
            renderer.deleteSelectedEdge();
        }
    });

    // Auto layout
    document.getElementById('btn-auto-layout').addEventListener('click', () => {
        renderer.autoLayout();
        showToast('Layout reorganized', 'success');
    });

    // Toolbar buttons
    document.getElementById('btn-export-png').addEventListener('click', handleExportPNG);
    document.getElementById('btn-export-svg').addEventListener('click', handleExportSVG);
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
        renderFromCode(currentBridgeCode);
        refineInput.value = '';
        updateStatus('ready', 'Refined');
        showToast('Flowchart refined!', 'success');

    } catch (err) {
        showToast(err.message, 'error');
        updateStatus('error', 'Error');
    } finally {
        refineBtn.disabled = false;
        refineBtn.textContent = 'Refine';
    }
}

// ═══ Render Bridge Code ═════════════════════════════════════════════════════

function renderFromCode(code) {
    if (!code || !code.trim()) {
        emptyState.style.display = 'block';
        renderer.svg.style.display = 'none';
        nodeCountEl.textContent = 'NODES: 0';
        edgeCountEl.textContent = 'EDGES: 0';
        return;
    }

    try {
        const parsed = parser.parse(code);

        if (parsed.nodes.length === 0) {
            emptyState.style.display = 'block';
            renderer.svg.style.display = 'none';
            showToast('No valid blocks found in the code.', 'error');
            return;
        }

        emptyState.style.display = 'none';
        renderer.svg.style.display = 'block';
        renderer.render(parsed);

        nodeCountEl.textContent = 'NODES: ' + parsed.nodes.length;
        edgeCountEl.textContent = 'EDGES: ' + parsed.edges.length;
        zoomLevelEl.textContent = Math.round(renderer.scale * 100) + '%';

    } catch (err) {
        console.error('Parse/render error:', err);
        showToast('Error parsing the Bridge Language code.', 'error');
    }
}

// ═══ Properties Panel ═══════════════════════════════════════════════════════

function showNodeProperties(node) {
    propsPanel.style.display = 'block';

    const shapeOptions = [
        { value: 'process', label: 'Rectangle' },
        { value: 'terminator', label: 'Oval' },
        { value: 'decision', label: 'Diamond' },
        { value: 'io', label: 'Parallelogram' },
    ];

    const colorOptions = [
        { value: 'blue', label: 'Blue', color: '#3b82f6' },
        { value: 'violet', label: 'Violet', color: '#7c3aed' },
        { value: 'red', label: 'Red', color: '#ef4444' },
        { value: 'amber', label: 'Amber', color: '#f59e0b' },
        { value: 'cyan', label: 'Cyan', color: '#06b6d4' },
        { value: 'green', label: 'Green', color: '#22c55e' },
        { value: 'pink', label: 'Pink', color: '#ec4899' },
        { value: 'reset', label: 'Default', color: '#888' },
    ];

    const shapeHtml = shapeOptions.map(s =>
        `<button class="prop-shape-btn ${(node.shapeOverride || node.type) === s.value ? 'active' : ''}" 
                data-shape="${s.value}" title="${s.label}">${s.label}</button>`
    ).join('');

    const colorHtml = colorOptions.map(c =>
        `<button class="prop-color-swatch" data-color="${c.value}" title="${c.label}"
                style="background: ${c.color}; ${c.value === 'reset' ? 'border: 1px dashed #666;' : ''}"></button>`
    ).join('');

    propsContent.innerHTML = `
        <div class="prop-group">
            <div class="prop-label">Text</div>
            <div class="prop-value">${escapeHtml(node.text)}</div>
        </div>
        <div class="prop-group">
            <div class="prop-label">Shape</div>
            <div class="prop-shape-row">${shapeHtml}</div>
        </div>
        <div class="prop-group">
            <div class="prop-label">Color</div>
            <div class="prop-color-row">${colorHtml}</div>
        </div>
        <div class="prop-group">
            <div class="prop-label">Size</div>
            <div class="prop-size-row">
                <button class="prop-size-btn" data-dw="-20" data-dh="0" title="Narrower">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                        <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                </button>
                <span class="prop-size-label">${Math.round(node.width)} x ${Math.round(node.height)}</span>
                <button class="prop-size-btn" data-dw="20" data-dh="0" title="Wider">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </button>
                <span style="margin: 0 4px;">|</span>
                <button class="prop-size-btn" data-dw="0" data-dh="-10" title="Shorter">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                        <polyline points="18 15 12 9 6 15"></polyline>
                    </svg>
                </button>
                <button class="prop-size-btn" data-dw="0" data-dh="10" title="Taller">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </button>
            </div>
        </div>
    `;

    // Attach shape handlers
    propsContent.querySelectorAll('.prop-shape-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            renderer.changeNodeShape(node.id, btn.dataset.shape);
            showNodeProperties(node); // refresh
        });
    });

    // Attach color handlers
    propsContent.querySelectorAll('.prop-color-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
            renderer.changeNodeColor(node.id, btn.dataset.color);
        });
    });

    // Attach size handlers
    propsContent.querySelectorAll('.prop-size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const dw = parseInt(btn.dataset.dw) || 0;
            const dh = parseInt(btn.dataset.dh) || 0;
            renderer.resizeNode(node.id, dw, dh);
            showNodeProperties(node); // refresh
        });
    });
}

function showEdgeProperties(edge) {
    propsPanel.style.display = 'block';
    const fromNode = renderer.nodes.find(n => n.id === edge.from);
    const toNode = renderer.nodes.find(n => n.id === edge.to);

    propsContent.innerHTML = `
        <div class="prop-group">
            <div class="prop-label">Arrow</div>
            <div class="prop-value">${escapeHtml(fromNode?.text || '?')} → ${escapeHtml(toNode?.text || '?')}</div>
        </div>
        <div class="prop-group">
            <div class="prop-label">Label</div>
            <div class="prop-value">${edge.label ? escapeHtml(edge.label) : '<em style="color:#666">None</em>'}</div>
        </div>
        <div class="prop-group">
            <button class="prop-action-btn" id="prop-edit-edge-label">Edit Label</button>
            <button class="prop-action-btn danger" id="prop-delete-edge">Delete Arrow</button>
        </div>
    `;

    document.getElementById('prop-edit-edge-label').addEventListener('click', () => {
        const newLabel = prompt('Arrow label:', edge.label || '');
        if (newLabel !== null) {
            edge.label = newLabel.trim() || null;
            renderer._saveUndoState();
            renderer._drawAll();
            showEdgeProperties(edge);
        }
    });

    document.getElementById('prop-delete-edge').addEventListener('click', () => {
        renderer.selectedEdge = edge;
        renderer.deleteSelectedEdge();
        hideProperties();
    });
}

function hideProperties() {
    propsPanel.style.display = 'none';
    propsContent.innerHTML = '';
}

// ═══ Export Functions ════════════════════════════════════════════════════════

async function handleExportPNG() {
    if (!currentBridgeCode && renderer.nodes.length === 0) {
        showToast('Generate a flowchart first.', 'error');
        return;
    }

    try {
        const dataUrl = await renderer.exportPNG();
        const link = document.createElement('a');
        link.download = 'flowchart.png';
        link.href = dataUrl;
        link.click();
        showToast('PNG exported!', 'success');
    } catch (err) {
        showToast('Export failed: ' + err.message, 'error');
    }
}

function handleExportSVG() {
    if (!currentBridgeCode && renderer.nodes.length === 0) {
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

function handleClearCode() {
    if (promptInput) promptInput.value = '';
    currentBridgeCode = '';
    emptyState.style.display = 'block';
    renderer.svg.style.display = 'none';
    renderer.nodes = [];
    renderer.edges = [];
    nodeCountEl.textContent = 'NODES: 0';
    edgeCountEl.textContent = 'EDGES: 0';
    hideProperties();
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

    // Use SVG icons instead of text characters
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
