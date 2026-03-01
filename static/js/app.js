/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Arka – Main Application Logic v3.0 (Mermaid JS)
 *  Handles UI interactions, API calls, Firebase, 
 *  and Mermaid orchestration.
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ── Firebase Config ─────────────────────────────────────────────────────────
// Configuration now handled by /static/js/firebase-init.js
// db and auth references are also globally available from there.

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

// ── API URL Helper ──────────────────────────────────────────────────────
// Detects environment and returns correct API base URL:
// - Vercel (*.vercel.app): relative URL (serverless functions handle it)
// - Flask (port 5000): relative URL (Flask handles it)
// - Live Server (any other port): proxy to Flask at localhost:5000
function getApiUrl(path) {
    const host = window.location.hostname;
    const port = window.location.port;
    // On Vercel or Flask (5000), use relative URLs
    if (host.includes('vercel.app') || port === '5000' || port === '') {
        return path;
    }
    // On Live Server or other, proxy to Flask
    return 'http://127.0.0.1:5000' + path;
}

// Safe JSON parse that prevents crashes on non-JSON responses
async function safeJsonParse(response) {
    const text = await response.text();
    if (!text || !text.trim()) {
        throw new Error('Server returned an empty response. Make sure the Flask server is running (python app.py).');
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        // Check if it's an HTML error page
        if (text.includes('<!DOCTYPE') || text.includes('<html') || text.includes('Cannot POST')) {
            throw new Error('API endpoint not found. Make sure the Flask server is running on port 5000 (python app.py).');
        }
        throw new Error('Invalid response from server: ' + text.substring(0, 100));
    }
}

// ── State ───────────────────────────────────────────────────────────────
let currentMermaidCode = '';
// db is already declared in firebase-init.js as: const db = firebase.database();
let currentMode = 'flowchart'; // 'flowchart' or 'block'
let currentTheme = 'default';
let currentScale = 1;
let selectedNodeOriginalText = '';
let selectedNodeElement = null;

const MODES = ['flowchart', 'block', 'architecture', 'sequence', 'timeline', 'gantt', 'pie', 'xy', 'er', 'state', 'class', 'git', 'quadrant', 'treemap'];
const appState = {};
MODES.forEach(m => appState[m] = { code: '', prompt: '', history: [], historyIndex: -1 });

// ═══ Initialization ═════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    // Wait for auth to be ready to properly setup app state
    firebase.auth().onAuthStateChanged((user) => {
        if (user) {
            console.log('User signed in', user.uid);
        }
    });

    // Ensure the theme name dynamically updates on load
    const btnText = document.getElementById('btn-theme-text');
    if (btnText) {
        btnText.textContent = currentTheme.charAt(0).toUpperCase() + currentTheme.slice(1);
    }

    initializeMermaidTheme();
    setupEventListeners();
    setupThemeDropdown();
    setupAppThemeToggle();
    setupModeToggle();
    updateStatus('ready', 'Ready');

    // Hide property panel since we don't use it initially
    document.getElementById('properties-panel').style.display = 'none';

    // Disable unneeded toolbars initially
    document.getElementById('btn-delete-selected').disabled = true;
    document.getElementById('btn-edit-text').disabled = true;
    document.getElementById('btn-auto-layout').disabled = true;
    updateHistoryButtons();

    // Mobile Desktop recommendation notice
    if (window.innerWidth <= 768 && !localStorage.getItem('hideMobileDesktopNotice')) {
        const notice = document.getElementById('mobile-notice');
        if (notice) {
            notice.style.display = 'flex';
        }
    }

    const closeNoticeBtn = document.getElementById('btn-close-mobile-notice');
    if (closeNoticeBtn) {
        closeNoticeBtn.addEventListener('click', () => {
            const notice = document.getElementById('mobile-notice');
            if (notice) {
                notice.classList.add('toast-exit');
                setTimeout(() => notice.style.display = 'none', 300);
            }
            localStorage.setItem('hideMobileDesktopNotice', 'true');
        });
    }
});

// Init handled by firebase-init.js globally.

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
        if (panZoomInstance) { panZoomInstance.zoomIn(); applyZoom(); }
    });
    document.getElementById('zoom-out').addEventListener('click', () => {
        if (panZoomInstance) { panZoomInstance.zoomOut(); applyZoom(); }
    });
    document.getElementById('zoom-fit').addEventListener('click', () => {
        if (panZoomInstance) { panZoomInstance.fit(); panZoomInstance.center(); applyZoom(); }
    });

    // Undo / Redo
    document.getElementById('btn-undo').addEventListener('click', handleUndo);
    document.getElementById('btn-redo').addEventListener('click', handleRedo);

    // Keyboard shortcuts for Undo and Redo
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            handleUndo();
        } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            handleRedo();
        }
    });

    // Toolbar buttons — download dropdown
    setupDownloadDropdown();
    document.getElementById('btn-export-svg').addEventListener('click', () => { closeDownloadDropdown(); handleExportSVG(); });
    document.getElementById('btn-export-png').addEventListener('click', () => { closeDownloadDropdown(); handleExportPNG(); });
    // Disable JSON export as it is irrelevant for raw Mermaid
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
    const mobileOverlay = document.getElementById('mobile-overlay');
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        if (mobileOverlay) mobileOverlay.classList.toggle('active');
    });

    if (mobileOverlay) {
        mobileOverlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            mobileOverlay.classList.remove('active');
        });
    }

    // Example chips
    document.querySelectorAll('.example-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            promptInput.value = chip.dataset.prompt;
            promptInput.focus();
        });
    });

    // Custom Edit Modal Binding
    document.getElementById('btn-edit-text').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selectedNodeOriginalText || !selectedNodeElement) return;

        const editInput = document.getElementById('edit-node-text-input');
        editInput.value = selectedNodeOriginalText;
        openModal('edit-text-modal');
        editInput.focus();
    });

    document.getElementById('edit-text-confirm').addEventListener('click', () => {
        const newText = document.getElementById('edit-node-text-input').value.trim();
        if (newText && newText !== selectedNodeOriginalText) {
            if (currentMermaidCode.includes(selectedNodeOriginalText)) {
                // Direct code replacement
                currentMermaidCode = currentMermaidCode.replace(selectedNodeOriginalText, newText);
                renderFromCode(currentMermaidCode);
            } else {
                // Fallback to AI Refine
                refineInput.value = `Change "${selectedNodeOriginalText}" to "${newText}"`;
                handleRefine();
            }
            resetSelection();
        }
        closeAllModals();
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

    const customConfirmBtn = document.getElementById('custom-theme-confirm');
    if (customConfirmBtn) {
        customConfirmBtn.addEventListener('click', () => {
            const p = document.getElementById('custom-primary').value || '#ffffff';
            const s = document.getElementById('custom-secondary').value || '#cccccc';
            const l = document.getElementById('custom-line').value || '#000000';

            CUSTOM_THEMES['custom'] = {
                theme: 'base',
                themeVariables: {
                    primaryColor: p,
                    primaryTextColor: l,
                    primaryBorderColor: l,
                    lineColor: l,
                    secondaryColor: s,
                    tertiaryColor: p,
                    fontFamily: 'Inter, sans-serif'
                }
            };

            const btnText = document.getElementById('btn-theme-text');
            if (btnText) btnText.textContent = 'Custom';

            currentTheme = 'custom';
            initializeMermaidTheme('custom');
            if (currentMermaidCode) {
                renderFromCode(currentMermaidCode);
            }
            showToast('Custom theme generated!', 'success');
            closeAllModals();
        });
    }
}

let panZoomInstance = null;

function applyZoom() {
    if (panZoomInstance) {
        // svg-pan-zoom handles zooming internally now. We just update the label correctly.
        zoomLevelEl.textContent = Math.round(panZoomInstance.getZoom() * 100) + '%';
    } else {
        zoomLevelEl.textContent = Math.round(currentScale * 100) + '%';
    }
}

// Modify the initial zoom controls logic replacing currentScale

// ═══ Global App Theme Toggle ════════════════════════════════════════════════

function setupAppThemeToggle() {
    const btn = document.getElementById('app-theme-toggle');
    const sunIcon = document.getElementById('theme-icon-sun');
    const moonIcon = document.getElementById('theme-icon-moon');
    const textSpan = document.getElementById('theme-toggle-text');
    if (!btn || !sunIcon || !moonIcon) return;

    // Check localStorage
    const savedTheme = localStorage.getItem('app-theme') || 'dark';
    if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
        sunIcon.style.display = 'none';
        moonIcon.style.display = 'block';
        if (textSpan) textSpan.textContent = 'Dark Theme';
    } else {
        if (textSpan) textSpan.textContent = 'Light Theme';
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isLight = document.body.classList.toggle('light-theme');
        if (isLight) {
            sunIcon.style.display = 'none';
            moonIcon.style.display = 'block';
            if (textSpan) textSpan.textContent = 'Dark Theme';
            localStorage.setItem('app-theme', 'light');
        } else {
            sunIcon.style.display = 'block';
            moonIcon.style.display = 'none';
            if (textSpan) textSpan.textContent = 'Light Theme';
            localStorage.setItem('app-theme', 'dark');
        }
    });
}

// ═══ Mode Toggle ════════════════════════════════════════════════════════════

function setupModeToggle() {
    const btn = document.getElementById('btn-mode-select');
    const menu = document.getElementById('mode-dropdown-menu');
    if (!btn || !menu) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#mode-dropdown-wrapper')) {
            menu.classList.remove('active');
        }
    });

    menu.querySelectorAll('.mode-option').forEach(option => {
        option.addEventListener('click', () => {
            const mode = option.getAttribute('data-mode');
            switchMode(mode);
            menu.classList.remove('active');
        });
    });
}

function switchMode(mode) {
    if (mode === currentMode) return;

    // Save previous state
    appState[currentMode].code = currentMermaidCode;
    appState[currentMode].prompt = promptInput.value;

    currentMode = mode;

    const subtitleText = document.getElementById('subtitle-text');
    const promptLabel = document.getElementById('prompt-label');
    const generateBtnText = document.getElementById('generate-btn-text');
    const emptyIcon = document.getElementById('empty-icon');
    const emptyTitle = document.getElementById('empty-title');
    const emptyDesc = document.getElementById('empty-desc');
    const btnModeText = document.getElementById('btn-mode-text');
    const examplesFlowchart = document.getElementById('examples-flowchart');
    const examplesBlock = document.getElementById('examples-block');

    const modeConfigs = {
        'flowchart': { title: 'AI Flowchart Generator', label: 'Describe your flow', btn: 'Generate Flowchart', place: 'e.g. A user login flow...', empty: '[ ]', text: 'Flowchart' },
        'block': { title: 'AI Block Diagram Generator', label: 'Describe your system', btn: 'Generate Diagram', place: 'e.g. A microservice architecture...', empty: '[ □ ]', text: 'Block Diagram' },
        'architecture': { title: 'AI Architecture Generator', label: 'Describe architecture', btn: 'Generate Architecture', place: 'e.g. Cloud AWS deployment...', empty: '[ ✦ ]', text: 'Architecture Diagram' },
        'sequence': { title: 'AI Sequence Generator', label: 'Describe actor sequence', btn: 'Generate Sequence', place: 'e.g. API auth handshake...', empty: '[ ⇵ ]', text: 'Sequence Diagrams' },
        'timeline': { title: 'AI Timeline Generator', label: 'Describe timeline events', btn: 'Generate Timeline', place: 'e.g. Project history 2020-2023...', empty: '[ ⧖ ]', text: 'Timelines' },
        'gantt': { title: 'AI Gantt Generator', label: 'Describe project tasks', btn: 'Generate Gantt', place: 'e.g. Website development phase...', empty: '[ ▤ ]', text: 'Gantt Charts' },
        'pie': { title: 'AI Pie Chart Generator', label: 'Describe breakdown %', btn: 'Generate Pie Chart', place: 'e.g. Market share apple 40%...', empty: '[ ◓ ]', text: 'Pie Charts' },
        'xy': { title: 'AI XY/Bar Generator', label: 'Describe chart data', btn: 'Generate Data Chart', place: 'e.g. Revenue per month in 2023...', empty: '[ 📊 ]', text: 'XY/Bar Charts' },
        'er': { title: 'AI ER Diagram Generator', label: 'Describe database entities', btn: 'Generate ER Diagram', place: 'e.g. User has many Orders...', empty: '[ ⚿ ]', text: 'ER Diagrams' },
        'state': { title: 'AI State Diagram Generator', label: 'Describe states', btn: 'Generate State Diagram', place: 'e.g. Application lifecycle states...', empty: '[ ⭮ ]', text: 'State Diagrams' },
        'class': { title: 'AI Class Diagram Generator', label: 'Describe classes', btn: 'Generate Class Diagram', place: 'e.g. User class with name, email...', empty: '[ 🗔 ]', text: 'Class Diagrams' },
        'git': { title: 'AI Gitgraph Generator', label: 'Describe git history', btn: 'Generate Gitgraph', place: 'e.g. Master branch, feature branch...', empty: '[ ⎇ ]', text: 'Gitgraphs' },
        'quadrant': { title: 'AI Quadrant Chart Generator', label: 'Describe quadrants', btn: 'Generate Quadrant Chart', place: 'e.g. Urgent vs Important matrix...', empty: '[ ⊞ ]', text: 'Quadrant Charts' },
        'treemap': { title: 'AI Treemap / Mindmap', label: 'Describe hierarchy', btn: 'Generate Mindmap', place: 'e.g. Project architecture overview...', empty: '[ 🗃 ]', text: 'Treemaps' }
    };

    const config = modeConfigs[mode] || modeConfigs['flowchart'];

    subtitleText.textContent = config.title;
    promptLabel.textContent = config.label;
    generateBtnText.textContent = config.btn;
    promptInput.placeholder = config.place;
    emptyIcon.textContent = config.empty;
    emptyTitle.textContent = 'AWAITING GENERATION';
    emptyDesc.textContent = 'Describe what you need in the sidebar to initialize rendering.';
    if (btnModeText) btnModeText.textContent = config.text;

    if (examplesFlowchart) examplesFlowchart.style.display = mode === 'flowchart' ? 'block' : 'none';
    if (examplesBlock) examplesBlock.style.display = mode === 'block' ? 'block' : 'none';

    bindExampleChips();

    // Load new state
    currentMermaidCode = appState[mode].code || '';
    promptInput.value = appState[mode].prompt || '';

    if (currentMermaidCode) {
        renderFromCode(currentMermaidCode);
    } else {
        showEmptyState();
    }

    resetSelection();
    updateStatus('ready', 'Ready');
    updateHistoryButtons();
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

// ═══ Core: Generate Diagram ═══════════════════════════════════════════════

async function handleGenerate() {
    const prompt = promptInput.value.trim();
    if (!prompt) {
        showToast(`Please describe the ${currentMode} you want to create.`, 'error');
        return;
    }

    const user = firebase.auth().currentUser;
    if (!user) {
        showToast('Please log in to generate diagrams.', 'error');
        return;
    }

    try {
        await checkUserLimits(user.uid, user.isAnonymous);
    } catch (limitError) {
        showToast(limitError.message, 'error');
        return;
    }

    generateBtn.classList.add('loading');
    generateBtn.disabled = true;
    updateStatus('loading', 'Generating...');


    const generateEndpoint = getApiUrl('/api/generate');

    try {
        const response = await fetch(generateEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, mode: currentMode })
        });

        const data = await safeJsonParse(response);

        if (!response.ok) {
            throw new Error(data.error || 'Generation failed');
        }

        let generatedCode = data.code;

        // Reset to Default Theme after generation
        if (currentTheme !== 'default') {
            const btnText = document.getElementById('btn-theme-text');
            if (btnText) btnText.textContent = 'Default';
            currentTheme = 'default';
            initializeMermaidTheme('default');
        }

        await incrementUserGenerationCount(user.uid, user.isAnonymous);
        // Await to ensure the ui updates before toast is dismissed
        await updateLiveCredits(user);

        currentMermaidCode = generatedCode;
        await renderFromCode(currentMermaidCode);
        updateStatus('ready', 'Generated');
        showToast(`${currentMode} generated successfully!`, 'success');

        // Update live credits dynamically after successful generation without refresh
        await updateLiveCredits(user);

        if (sidebar && sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
            const mobileOverlay = document.getElementById('mobile-overlay');
            if (mobileOverlay) mobileOverlay.classList.remove('active');
        }

    } catch (err) {
        console.error('Generate error:', err);
        updateStatus('error', 'Error');
        showToast(err.message, 'error');
    } finally {
        generateBtn.classList.remove('loading');
        generateBtn.disabled = false;
    }
}

// ═══ Core: Refine Diagram ═════════════════════════════════════════════════

async function handleRefine() {
    const instruction = refineInput.value.trim();
    if (!instruction) {
        showToast('Enter a refinement instruction.', 'error');
        return;
    }
    if (!currentMermaidCode) {
        showToast(`Generate a ${currentMode} first.`, 'error');
        return;
    }

    refineBtn.disabled = true;
    refineBtn.textContent = 'Refining...';
    updateStatus('loading', 'Refining...');

    const refineEndpoint = getApiUrl('/api/refine');

    // Backup the current code before refining so we can rollback on failure
    const backupCode = currentMermaidCode;

    try {
        const response = await fetch(refineEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_code: currentMermaidCode, instruction, mode: currentMode })
        });

        const data = await safeJsonParse(response);
        if (!response.ok) throw new Error(data.error || 'Refinement failed');

        currentMermaidCode = data.code;

        try {
            await renderFromCode(currentMermaidCode);
        } catch (renderErr) {
            // If rendering the refined code fails, rollback to backup
            console.warn('Refined code failed to render, rolling back:', renderErr);
            currentMermaidCode = backupCode;
            await renderFromCode(currentMermaidCode);
            showToast('Refined code had errors. Reverted to previous version.', 'error');
            refineBtn.disabled = false;
            refineBtn.textContent = 'Refine';
            return;
        }

        refineInput.value = '';
        updateStatus('ready', 'Refined');
        showToast(`${currentMode} refined!`, 'success');

        if (sidebar && sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
            const mobileOverlay = document.getElementById('mobile-overlay');
            if (mobileOverlay) mobileOverlay.classList.remove('active');
        }

    } catch (err) {
        // Rollback on any failure
        if (backupCode && backupCode !== currentMermaidCode) {
            currentMermaidCode = backupCode;
            try { await renderFromCode(currentMermaidCode); } catch (e) { /* ignore */ }
        }
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

function updateHistoryButtons() {
    const state = appState[currentMode];
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.disabled = state.historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = state.historyIndex >= state.history.length - 1;
}

function handleUndo() {
    const state = appState[currentMode];
    if (state.historyIndex > 0) {
        state.historyIndex--;
        currentMermaidCode = state.history[state.historyIndex];
        renderFromCode(currentMermaidCode, false);
    }
}

function handleRedo() {
    const state = appState[currentMode];
    if (state.historyIndex < state.history.length - 1) {
        state.historyIndex++;
        currentMermaidCode = state.history[state.historyIndex];
        renderFromCode(currentMermaidCode, false);
    }
}

async function renderFromCode(code, pushToHistory = true) {
    const state = appState[currentMode];

    if (!code || !code.trim()) {
        showEmptyState();
        return;
    }

    if (pushToHistory) {
        if (state.historyIndex < state.history.length - 1) {
            state.history.length = state.historyIndex + 1; // truncate future
        }
        if (state.history.length === 0 || state.history[state.history.length - 1] !== code) {
            state.history.push(code);
            state.historyIndex++;
        }
    }
    updateHistoryButtons();

    try {
        // Clean up any previously created render SVG element (Mermaid won't re-render same ID)
        ['mermaid-svg-graph', 'dmermaid-svg-graph'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });

        // Client-side code cleanup before render
        let cleanedCode = cleanMermaidCodeClient(code);

        let svg;
        try {
            const result = await mermaid.render('mermaid-svg-graph', cleanedCode);
            svg = result.svg;
        } catch (firstErr) {
            // Try auto-fixing common issues and retry once
            console.warn('First render attempt failed, trying auto-fix...', firstErr.message);
            cleanedCode = autoFixMermaidCode(cleanedCode);

            // Clean up failed render artifacts
            ['mermaid-svg-graph', 'dmermaid-svg-graph'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.remove();
            });

            const retryResult = await mermaid.render('mermaid-svg-graph', cleanedCode);
            svg = retryResult.svg;
            // Update the code with the fixed version
            currentMermaidCode = cleanedCode;
        }

        canvasContainer.innerHTML = svg;
        canvasContainer.appendChild(emptyState); // Re-append it so it's not destroyed
        emptyState.style.display = 'none';

        // Count rough metrics
        const matchesNodes = cleanedCode.match(/\[|\]|\(|\)|\{|\}/g);
        const matchesEdges = cleanedCode.match(/--|==|-\.>|-->|==>|\.-/g);
        nodeCountEl.textContent = 'NODES: ' + (matchesNodes ? Math.floor(matchesNodes.length / 2) : '?');
        edgeCountEl.textContent = 'EDGES: ' + (matchesEdges ? matchesEdges.length : '?');

        // Initialize svg-pan-zoom
        const svgEl = canvasContainer.querySelector('svg');
        if (svgEl) {
            // Strip Mermaid's intrinsic limits so svg-pan-zoom doesn't get boxed/cut off.
            svgEl.style.maxWidth = 'none';
            svgEl.style.width = '100%';
            svgEl.style.height = '100%';

            // Add click-to-edit capability
            const nodesAndEdges = canvasContainer.querySelectorAll('.node, .edgeLabel');

            canvasContainer.addEventListener('click', () => {
                resetSelection(nodesAndEdges);
            });

            nodesAndEdges.forEach(element => {
                element.style.cursor = 'pointer';
                element.title = 'Select to Edit';
                element.addEventListener('click', (e) => {
                    e.stopPropagation();
                    resetSelection(nodesAndEdges);

                    selectedNodeOriginalText = element.textContent.trim();
                    selectedNodeElement = element;
                    if (!selectedNodeOriginalText) return;

                    // Double click to instantly edit text without toolbar
                    element.addEventListener('dblclick', (dblEvent) => {
                        dblEvent.stopPropagation();
                        dblEvent.preventDefault();
                        const editBtn = document.getElementById('btn-edit-text');
                        if (editBtn && !editBtn.disabled) {
                            editBtn.click();
                        }
                    }, { once: true });

                    const isEdge = element.classList.contains('edgeLabel');
                    if (isEdge) {
                        element.style.filter = 'drop-shadow(0 0 8px #ffffff)';
                    } else {
                        // dotted cyan neon light
                        const shapes = element.querySelectorAll('rect, circle, polygon, path');
                        shapes.forEach(shape => {
                            shape.dataset.origStroke = shape.style.stroke || shape.getAttribute('stroke') || '';
                            shape.dataset.origDash = shape.style.strokeDasharray || shape.getAttribute('stroke-dasharray') || '';
                            shape.dataset.origFilter = shape.style.filter || shape.getAttribute('filter') || '';
                            shape.style.stroke = '#00ffff';
                            shape.style.strokeDasharray = '5, 5';
                            shape.style.filter = 'drop-shadow(0 0 8px #00ffff)';
                        });
                        // Fallback
                        if (shapes.length === 0) {
                            element.style.filter = 'drop-shadow(0 0 10px #00ffff)';
                        }
                    }

                    const editBtn = document.getElementById('btn-edit-text');
                    if (editBtn) {
                        editBtn.disabled = false;
                        editBtn.style.color = 'var(--fg)';
                        editBtn.style.borderColor = 'var(--fg)';
                    }

                    // Show color tray popup near the edit button
                    showColorTray(element);
                });
            });

            if (panZoomInstance) {
                panZoomInstance.destroy();
            }
            panZoomInstance = svgPanZoom(svgEl, {
                zoomEnabled: true,
                controlIconsEnabled: false,
                fit: true,
                center: true,
                minZoom: 0.1,
                maxZoom: 10,
                onZoom: function () { applyZoom(); }
            });
        }

        currentScale = 1;
        applyZoom();

    } catch (err) {
        console.error('Parse/render error:', err);
        showToast('Error parsing the Mermaid code: ' + err.message, 'error');
    }
}

// ═══ Client-Side Mermaid Code Cleanup ═══════════════════════════════════════

function cleanMermaidCodeClient(code) {
    if (!code) return code;
    // Remove markdown fences the AI may have wrapped
    code = code.replace(/```(?:mermaid|json|text)?\s*\n?/g, '').trim();
    // Remove stray backslashes
    code = code.replace(/\\(?!["\\nrt])/g, '');
    // Remove parentheses from gantt/timeline labels
    return code;
}

function autoFixMermaidCode(code) {
    if (!code) return code;
    // Remove all parentheses from non-flowchart diagrams
    const lines = code.split('\n');
    const firstLine = lines[0].trim().toLowerCase();

    if (firstLine.startsWith('gantt') || firstLine.startsWith('timeline')) {
        // Remove parentheses from all lines (except first)
        code = lines.map((line, i) => {
            if (i === 0) return line;
            return line.replace(/[()\\]/g, '');
        }).join('\n');
    }

    if (firstLine.startsWith('gitgraph') || firstLine.startsWith('gitGraph')) {
        // Fix common git graph issues
        code = code.replace(/commit msg:/g, 'commit id:');
        code = lines.map((line, i) => {
            if (i === 0) return line;
            return line.replace(/[()\\]/g, '');
        }).join('\n');
    }

    return code;
}

// ═══ Color Tray (appears under Edit icon) ═══════════════════════════════════

function showColorTray(element) {
    // Remove any existing color tray
    const existingTray = document.getElementById('floating-color-tray');
    if (existingTray) existingTray.remove();

    const editBtn = document.getElementById('btn-edit-text');
    if (!editBtn) return;

    const tray = document.createElement('div');
    tray.id = 'floating-color-tray';
    tray.style.cssText = `
        position: absolute;
        top: calc(100% + 8px);
        left: 50%;
        transform: translateX(-50%);
        background: rgba(15, 15, 15, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 8px;
        display: flex;
        gap: 6px;
        z-index: 1000;
        backdrop-filter: blur(12px);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
        animation: fadeInDown 0.15s ease-out;
    `;

    const colors = [
        { color: '#222222', label: 'Dark' },
        { color: '#555555', label: 'Gray' },
        { color: '#E52E2E', label: 'Red' },
        { color: '#3b82f6', label: 'Blue' },
        { color: '#10b981', label: 'Green' },
        { color: '#f59e0b', label: 'Amber' },
        { color: '#8b5cf6', label: 'Purple' },
        { color: '#ec4899', label: 'Pink' }
    ];

    colors.forEach(({ color, label }) => {
        const swatch = document.createElement('button');
        swatch.title = label;
        swatch.style.cssText = `
            width: 24px; height: 24px;
            min-width: 24px; min-height: 24px;
            padding: 0; margin: 0;
            flex-shrink: 0;
            box-sizing: border-box;
            border-radius: 50%;
            border: 2px solid rgba(255,255,255,0.15);
            background: ${color};
            cursor: pointer;
            transition: transform 0.15s, border-color 0.15s;
        `;
        swatch.addEventListener('mouseenter', () => {
            swatch.style.transform = 'scale(1.2)';
            swatch.style.borderColor = '#fff';
        });
        swatch.addEventListener('mouseleave', () => {
            swatch.style.transform = 'scale(1)';
            swatch.style.borderColor = 'rgba(255,255,255,0.15)';
        });
        swatch.addEventListener('click', (e) => {
            e.stopPropagation();
            applyColorToNode(element, color);
        });
        tray.appendChild(swatch);
    });

    // Position it relative to the edit button
    const editBtnWrapper = editBtn.parentElement;
    editBtnWrapper.style.position = 'relative';
    editBtnWrapper.appendChild(tray);

    // Close tray when clicking outside
    const closeTray = (e) => {
        if (!tray.contains(e.target) && e.target !== editBtn) {
            tray.remove();
            document.removeEventListener('click', closeTray);
        }
    };
    setTimeout(() => document.addEventListener('click', closeTray), 50);
}

function applyColorToNode(element, color) {
    // Apply color directly to the SVG shapes (instant visual feedback)
    const shapes = element.querySelectorAll('rect, circle, polygon, path');
    shapes.forEach(shape => {
        shape.style.fill = color;
    });

    // Also try to apply via Mermaid style directive in the code so it persists
    const svgId = element.id;
    if (svgId && currentMermaidCode) {
        // Extract real Mermaid ID from SVG DOM ID (e.g., 'flowchart-C-3' -> 'C')
        let realId = svgId;
        const parts = svgId.split('-');
        if (parts.length >= 3 && (svgId.startsWith('flowchart-') || svgId.startsWith('state-'))) {
            realId = parts.slice(1, -1).join('-');
        }

        // Only add for flowchart/graph types
        const firstLine = currentMermaidCode.trim().split('\n')[0].toLowerCase();
        if (firstLine.startsWith('graph') || firstLine.startsWith('flowchart')) {
            // Check if a style for this node already exists, if so, we just append a new one (Mermaid uses the last one)
            const styleDirective = `\n    style ${realId} fill:${color},color:#fff`;
            currentMermaidCode += styleDirective;
        }
    }

    showToast(`Color applied to "${selectedNodeOriginalText}"`, 'success');

    // Remove the color tray
    const tray = document.getElementById('floating-color-tray');
    if (tray) tray.remove();
}

// ═══ Live Credits Update ════════════════════════════════════════════════════

function checkAndInjectBMCWidget(usageCount, isAnonymous) {
    if (!isAnonymous && usageCount >= 6 && !document.getElementById('bmc-widget-script')) {
        const script = document.createElement('script');
        script.id = 'bmc-widget-script';
        script.setAttribute('data-name', 'BMC-Widget');
        script.setAttribute('data-cfasync', 'false');
        script.src = 'https://cdnjs.buymeacoffee.com/1.0.0/widget.prod.min.js';
        script.setAttribute('data-id', 'dhruvgautam');
        script.setAttribute('data-description', 'Support me on Buy me a coffee!');
        script.setAttribute('data-message', 'If you love what I built, consider buying me a coffee! ☕');
        script.setAttribute('data-color', '#5F7FFF');
        script.setAttribute('data-position', 'Right');
        script.setAttribute('data-x_margin', '18');
        script.setAttribute('data-y_margin', '18');
        document.body.appendChild(script);
    }
}

async function updateLiveCredits(user) {
    if (!user) user = firebase.auth().currentUser;
    if (!user) return;

    try {
        const data = await checkUserLimits(user.uid, user.isAnonymous);
        const today = new Date().toISOString().split('T')[0];
        const todayUsage = (data.dailyUsage && data.dailyUsage[today]) ? data.dailyUsage[today] : 0;

        const statEl = document.getElementById('user-usage-stats');
        if (!statEl) return;

        if (user.isAnonymous) {
            const guestTotal = data.totalGuestDiagrams || 0;
            statEl.innerText = `Credits: ${guestTotal} / 5 Limit`;
            if (guestTotal >= 5) {
                statEl.style.color = '#ff4d4d';
            } else {
                statEl.style.color = '';
            }
            checkAndInjectBMCWidget(guestTotal, user.isAnonymous);
        } else {
            statEl.innerText = `Credits: ${todayUsage} / 10 Limit`;
            if (todayUsage >= 10) {
                statEl.style.color = '#ff4d4d';
            } else {
                statEl.style.color = '';
            }
            checkAndInjectBMCWidget(todayUsage, user.isAnonymous);
        }
    } catch (e) {
        const statEl = document.getElementById('user-usage-stats');
        if (user.isAnonymous) {
            statEl.innerText = `Credits: Limit Reached (5/5)`;
        } else {
            statEl.innerText = `Credits: Limit Reached (10/10)`;
        }
        statEl.style.color = '#ff4d4d';
        if (!user.isAnonymous) {
            checkAndInjectBMCWidget(10, user.isAnonymous);
        }
    }
}

// ═══ Export Functions ════════════════════════════════════════════════════════

async function handleExportSVG() {
    const exportType = currentMode;
    if (!currentMermaidCode) {
        showToast(`Generate a ${currentMode} first.`, 'error');
        return;
    }

    // Check download limits for guest users
    const user = firebase.auth().currentUser;
    if (user) {
        try {
            const limitCheck = await checkDownloadLimit(user.uid, user.isAnonymous);
            if (!limitCheck.allowed) {
                showToast('Guest download limit reached! Sign up with Google for unlimited downloads.', 'error');
                // Open profile dropdown to show signup button
                const profileMenu = document.getElementById('profile-dropdown-menu');
                if (profileMenu) profileMenu.classList.add('active');
                return;
            }
        } catch (e) {
            console.error('Download limit check failed:', e);
        }
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

    // Increment download count
    if (user) {
        await incrementDownloadCount(user.uid);
    }
    showToast('SVG exported!', 'success');
}

async function handleExportPNG() {
    const exportType = currentMode;
    if (!currentMermaidCode) {
        showToast(`Generate a ${currentMode} first.`, 'error');
        return;
    }

    // Check download limits for guest users
    const user = firebase.auth().currentUser;
    if (user) {
        try {
            const limitCheck = await checkDownloadLimit(user.uid, user.isAnonymous);
            if (!limitCheck.allowed) {
                showToast('Guest download limit reached! Sign up with Google for unlimited downloads.', 'error');
                // Open profile dropdown to show signup button
                const profileMenu = document.getElementById('profile-dropdown-menu');
                if (profileMenu) profileMenu.classList.add('active');
                return;
            }
        } catch (e) {
            console.error('Download limit check failed:', e);
        }
    }

    updateStatus('loading', 'Exporting PNG...');

    try {
        // Clean up any previously created export SVG element (Mermaid won't re-render same ID)
        // Mermaid creates elements with both the given id and 'd' + id
        ['mermaid-export-graph', 'dmermaid-export-graph'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });

        // Render a brand new clean invisible SVG to entirely bypass UI pan/zoom visual artifacts
        const { svg } = await mermaid.render('mermaid-export-graph', currentMermaidCode);

        // Parse it explicitly into DOM
        const parser = new DOMParser();
        const doc = parser.parseFromString(svg, 'image/svg+xml');
        const svgElement = doc.documentElement;

        // Extract native original proportions
        let width = 1200, height = 1200;
        if (svgElement.getAttribute('viewBox')) {
            const parts = svgElement.getAttribute('viewBox').split(' ');
            width = parseFloat(parts[2]);
            height = parseFloat(parts[3]);
        }

        // Force native sizes explicitly to bypass embedded intrinsic boundaries
        svgElement.style.maxWidth = 'none';
        svgElement.setAttribute('width', width);
        svgElement.setAttribute('height', height);

        const modSvgData = new XMLSerializer().serializeToString(svgElement);

        const canvas = document.createElement('canvas');
        canvas.width = width * 2; // High-res output
        canvas.height = height * 2;
        const ctx = canvas.getContext('2d');
        ctx.scale(2, 2);

        // Fill background cleanly based on App Theme
        const isLightTheme = document.body.classList.contains('light-theme');
        ctx.fillStyle = isLightTheme ? "#ffffff" : "#000000";
        ctx.fillRect(0, 0, width, height);

        const img = new Image();
        img.onload = async () => {
            ctx.drawImage(img, 0, 0, width, height);
            const link = document.createElement('a');
            link.download = `${exportType}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();

            // Increment download count after successful export
            if (user) {
                await incrementDownloadCount(user.uid);
            }
            updateStatus('ready', 'Exported');
            showToast('High-Res PNG exported!', 'success');
        };
        img.onerror = () => {
            showToast('Image encoding failed. Trying SVG export instead.', 'error');
            handleExportSVG();
        };

        // Use Unicode-safe encoding to guarantee no text crashes
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(modSvgData);

    } catch (err) {
        showToast('PNG Export failed: ' + err.message, 'error');
        updateStatus('error', 'Error');
    }
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

// ═══ Theme Dropdown ═══════════════════════════════════════════════════════

const CUSTOM_THEMES = {
    cyberpunk: {
        theme: 'base',
        themeVariables: {
            primaryColor: '#ff003c',
            primaryTextColor: '#fff',
            primaryBorderColor: '#00f0ff',
            lineColor: '#fcee0a',
            secondaryColor: '#120458',
            tertiaryColor: '#fff',
            fontFamily: 'Orbitron, sans-serif'
        }
    },
    pastel: {
        theme: 'base',
        themeVariables: {
            primaryColor: '#ffb3ba',
            primaryTextColor: '#333',
            primaryBorderColor: '#ffdfba',
            lineColor: '#baffc9',
            secondaryColor: '#ffffba',
            tertiaryColor: '#bae1ff',
            fontFamily: 'Space Grotesk, sans-serif'
        }
    },
    retro: {
        theme: 'base',
        themeVariables: {
            primaryColor: '#f4a261',
            primaryTextColor: '#264653',
            primaryBorderColor: '#e76f51',
            lineColor: '#2a9d8f',
            secondaryColor: '#e9c46a',
            tertiaryColor: '#f4a261',
            fontFamily: 'Space Mono, monospace'
        }
    },
    handdrawn: {
        theme: 'base',
        look: 'handDrawn',
        themeVariables: {
            fontFamily: '"Comic Sans MS", "Chalkboard SE", "Comic Neue", cursive, sans-serif',
            primaryColor: '#ffffff',
            primaryTextColor: '#333333',
            primaryBorderColor: '#333333',
            lineColor: '#333333'
        }
    },
    minimalist: {
        theme: 'base',
        themeVariables: {
            primaryColor: '#ffffff',
            primaryTextColor: '#000000',
            primaryBorderColor: '#000000',
            lineColor: '#000000',
            secondaryColor: '#f4f4f4',
            tertiaryColor: '#ffffff',
            fontFamily: 'Inter, sans-serif'
        }
    },
    neon: {
        theme: 'base',
        themeVariables: {
            primaryColor: '#0b0c10',
            primaryTextColor: '#66fcf1',
            primaryBorderColor: '#45a29e',
            lineColor: '#c5c6c7',
            secondaryColor: '#1f2833',
            tertiaryColor: '#66fcf1',
            fontFamily: 'Space Mono, monospace'
        }
    }
};

let isPreviewing = false;

function initializeMermaidTheme(themeToUse) {
    let theme = themeToUse || currentTheme;
    let config = { startOnLoad: false, securityLevel: 'loose', look: 'classic' };
    if (CUSTOM_THEMES[theme]) {
        config = { ...config, ...CUSTOM_THEMES[theme] };
    } else {
        config.theme = theme;
    }
    mermaid.initialize(config);
}

function previewThemeChange(theme) {
    if (!currentMermaidCode || currentTheme === theme) return;
    isPreviewing = true;
    initializeMermaidTheme(theme);
    renderFromCode(currentMermaidCode);
}

function resetThemePreview() {
    if (!isPreviewing) return;
    isPreviewing = false;
    initializeMermaidTheme(currentTheme);
    if (currentMermaidCode) {
        renderFromCode(currentMermaidCode);
    }
}

function setupThemeDropdown() {
    const btn = document.getElementById('btn-theme');
    const menu = document.getElementById('theme-dropdown-menu');
    if (!btn || !menu) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = menu.classList.toggle('active');
        if (!isActive) {
            resetThemePreview();
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#theme-dropdown-wrapper')) {
            if (menu.classList.contains('active')) {
                resetThemePreview();
                menu.classList.remove('active');
            }
        }
    });

    menu.querySelectorAll('.theme-option').forEach(option => {
        const theme = option.getAttribute('data-theme');

        option.addEventListener('mouseenter', () => {
            previewThemeChange(theme);
        });

        option.addEventListener('click', (e) => {
            if (theme === 'custom') {
                e.preventDefault();
                openModal('custom-theme-modal');
                menu.classList.remove('active');
            } else {
                changeTheme(theme);
                menu.classList.remove('active');
            }
        });
    });

    menu.addEventListener('mouseleave', () => {
        resetThemePreview();
    });
}

function changeTheme(theme) {
    if (currentTheme === theme) return;
    currentTheme = theme;
    isPreviewing = false;

    // Update button text explicitly
    const btnText = document.getElementById('btn-theme-text');
    if (btnText) {
        btnText.textContent = theme.charAt(0).toUpperCase() + theme.slice(1);
    }

    initializeMermaidTheme(currentTheme);
    if (currentMermaidCode) {
        renderFromCode(currentMermaidCode);
    }
    showToast(`Theme changed to ${theme}`, 'success');
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

// ═══ Firebase Save & Load ═══════════════════════════════════════════════════

async function handleSave() {
    const nameInput = document.getElementById('save-name');
    const folderSelect = document.getElementById('save-folder');
    const folderId = folderSelect ? folderSelect.value : 'folder1';
    const name = nameInput.value.trim();

    if (!name) {
        showToast(`Enter a name for the diagram.`, 'error');
        return;
    }
    if (!currentMermaidCode) {
        showToast(`Generate a diagram first.`, 'error');
        return;
    }

    const user = firebase.auth().currentUser;
    if (!user) {
        showToast('You must be logged in to save.', 'error');
        return;
    }

    // Check Limits (3 folders config, 3 diagrams per folder)
    const folderRef = db.ref(`users/${user.uid}/folders/${folderId}`);
    try {
        const snapshot = await folderRef.once('value');
        const folderData = snapshot.val() || {};
        const diagramCount = Object.keys(folderData).length;

        if (diagramCount >= 3) {
            showToast('Premium Required! Folder is full (max 3 diagrams/folder).', 'error');
            return;
        }

        const flowchartData = {
            name,
            code: currentMermaidCode,
            prompt: promptInput.value,
            mode: currentMode,
            createdAt: Date.now()
        };

        const newRef = folderRef.push();
        await newRef.set(flowchartData);

        showToast(`Saved "${name}" into ${folderId} successfully!`, 'success');
        closeAllModals();
        nameInput.value = '';
    } catch (err) {
        showToast('Save failed: ' + err.message, 'error');
    }
}

function handleOpenLoad() {
    const user = firebase.auth().currentUser;
    if (!user) {
        showToast('Please log in to load.', 'error');
        return;
    }

    openModal('load-modal');
    const listEl = document.getElementById('saved-list');
    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">Loading...</div>';

    db.ref(`users/${user.uid}/folders`).once('value')
        .then(foldersSnap => {
            const folders = foldersSnap.val() || {};
            let items = [];

            // Reconstruct array for display
            Object.keys(folders).forEach(fKey => {
                const diagrams = folders[fKey];
                Object.keys(diagrams).forEach(dKey => {
                    items.push({ id: dKey, folder: fKey, ...diagrams[dKey] });
                });
            });

            items.sort((a, b) => b.createdAt - a.createdAt);

            if (items.length === 0) {
                listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">No saved flowcharts.</div>';
                return;
            }

            listEl.innerHTML = '';
            items.forEach(item => {
                const div = document.createElement('div');
                div.className = 'saved-item';
                div.innerHTML = `
                        <div style="text-align: left;">
                        <div class="saved-item-name">${escapeHtml(item.name)} <span style="font-size:0.75rem; color:#888;">(${item.folder})</span></div>
                        <div class="saved-item-date">${new Date(item.createdAt).toLocaleDateString()}</div>
                        </div>
                        <div class="saved-item-actions">
                            <button class="saved-item-btn load-item" data-id="${item.id}" data-folder="${item.folder}">Load</button>
                            <button class="saved-item-btn delete" data-id="${item.id}" data-folder="${item.folder}">
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
                btn.addEventListener('click', () => loadFlowchart(btn.dataset.folder, btn.dataset.id));
            });

            listEl.querySelectorAll('.delete').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteFlowchart(btn.dataset.folder, btn.dataset.id);
                });
            });
        })
        .catch(err => {
            listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--error);">Error: ${err.message}</div>`;
        });
}

function loadFlowchart(folderId, id) {
    const user = firebase.auth().currentUser;
    db.ref(`users/${user.uid}/folders/${folderId}/${id}`).once('value')
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

function deleteFlowchart(folderId, id) {
    if (confirm('Delete this flowchart?')) {
        const user = firebase.auth().currentUser;
        db.ref(`users/${user.uid}/folders/${folderId}/${id}`).remove()
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

// ═══ Custom Modal Logic ═════════════════════════════════════════════════════

function resetSelection(nodesAndEdges = null) {
    if (!nodesAndEdges && canvasContainer) {
        nodesAndEdges = canvasContainer.querySelectorAll('.node, .edgeLabel');
    }
    if (nodesAndEdges) {
        nodesAndEdges.forEach(n => {
            n.style.filter = '';
            const shapes = n.querySelectorAll('rect, circle, polygon, path');
            shapes.forEach(shape => {
                if (shape.dataset.origStroke !== undefined) {
                    shape.style.stroke = shape.dataset.origStroke;
                    shape.style.strokeDasharray = shape.dataset.origDash;
                    shape.style.filter = shape.dataset.origFilter;
                }
            });
        });
    }

    selectedNodeOriginalText = '';
    selectedNodeElement = null;

    const editBtn = document.getElementById('btn-edit-text');
    if (editBtn) {
        editBtn.disabled = true;
        editBtn.style.color = '';
        editBtn.style.filter = '';
        editBtn.style.borderColor = '';
    }

    const propPanel = document.getElementById('properties-panel');
    if (propPanel) propPanel.style.display = 'none';
}

