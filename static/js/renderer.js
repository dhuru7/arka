/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FlowChart Interactive SVG Renderer v2.0
 *  Full interactive editing: drag nodes, edit text, change shapes/colors,
 *  resize nodes, editable arrows, undo/redo, and auto-layout.
 * ═══════════════════════════════════════════════════════════════════════════
 */

class FlowchartRenderer {
    constructor(containerEl) {
        this.container = containerEl;

        // ── Pan & Zoom ────────────────────────────────────────────────────
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;

        // ── Layout Config (MUST be initialized before _createDefs) ────────
        this.config = {
            nodeMinWidth: 160,
            nodeMaxWidth: 260,
            nodeHeight: 50,
            nodePadding: 20,
            decisionWidth: 140,
            decisionHeight: 90,
            terminatorHeight: 44,
            ioSkew: 18,
            connectorRadius: 16,
            subBlockWidth: 240,
            subBlockHeight: 100,

            horizontalGap: 80,
            verticalGap: 70,

            colors: {
                terminator: { bg: '#1a1a2e', border: '#7c3aed', text: '#e0e0ff', glow: 'rgba(124,58,237,0.3)' },
                terminator_start: { bg: '#1a1a2e', border: '#7c3aed', text: '#e0e0ff', glow: 'rgba(124,58,237,0.3)' },
                terminator_end: { bg: '#1a1a2e', border: '#ef4444', text: '#fecaca', glow: 'rgba(239,68,68,0.3)' },
                process: { bg: '#111827', border: '#3b82f6', text: '#bfdbfe', glow: 'rgba(59,130,246,0.25)' },
                decision: { bg: '#1c1917', border: '#f59e0b', text: '#fde68a', glow: 'rgba(245,158,11,0.25)' },
                io: { bg: '#0f172a', border: '#06b6d4', text: '#a5f3fc', glow: 'rgba(6,182,212,0.25)' },
                connector: { bg: '#1e1b4b', border: '#818cf8', text: '#c7d2fe', glow: 'rgba(129,140,248,0.25)' },
                sub_block: { bg: '#1a1a2e', border: '#8b5cf6', text: '#ddd6fe', glow: 'rgba(139,92,246,0.25)' }
            },

            arrowColor: '#6366f1',
            arrowLabelColor: '#a5b4fc',
        };

        // ── Create SVG element ────────────────────────────────────────────
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        this.svg.setAttribute('class', 'flowchart-svg');
        this.svg.setAttribute('width', '100%');
        this.svg.setAttribute('height', '100%');
        this.container.appendChild(this.svg);

        // Arrow marker defs (config must be set before this)
        this._createDefs();

        // Main group for pan/zoom transform
        this.mainGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.mainGroup.setAttribute('class', 'main-group');
        this.svg.appendChild(this.mainGroup);

        // Layers
        this.edgeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.edgeLayer.setAttribute('class', 'edge-layer');
        this.mainGroup.appendChild(this.edgeLayer);

        this.nodeLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.nodeLayer.setAttribute('class', 'node-layer');
        this.mainGroup.appendChild(this.nodeLayer);

        // ── State ─────────────────────────────────────────────────────────
        this.nodes = [];
        this.edges = [];
        this.selectedNode = null;
        this.selectedEdge = null;
        this.isDragging = false;
        this.dragNode = null;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.nodeStartX = 0;
        this.nodeStartY = 0;

        // ── Undo/Redo ─────────────────────────────────────────────────────
        this.undoStack = [];
        this.redoStack = [];
        this.maxUndoSteps = 50;

        this._setupInteraction();
    }

    // ═══ SVG Defs (arrow markers, filters) ══════════════════════════════════

    _createDefs() {
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

        // Arrow marker
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', 'arrowhead');
        marker.setAttribute('markerWidth', '12');
        marker.setAttribute('markerHeight', '8');
        marker.setAttribute('refX', '11');
        marker.setAttribute('refY', '4');
        marker.setAttribute('orient', 'auto');
        marker.setAttribute('markerUnits', 'userSpaceOnUse');

        const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        arrowPath.setAttribute('d', 'M0,0 L12,4 L0,8 L3,4 Z');
        arrowPath.setAttribute('fill', this.config.arrowColor);
        marker.appendChild(arrowPath);
        defs.appendChild(marker);

        // Back-ref arrow marker
        const markerBack = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        markerBack.setAttribute('id', 'arrowhead-back');
        markerBack.setAttribute('markerWidth', '12');
        markerBack.setAttribute('markerHeight', '8');
        markerBack.setAttribute('refX', '11');
        markerBack.setAttribute('refY', '4');
        markerBack.setAttribute('orient', 'auto');
        markerBack.setAttribute('markerUnits', 'userSpaceOnUse');

        const arrowPathBack = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        arrowPathBack.setAttribute('d', 'M0,0 L12,4 L0,8 L3,4 Z');
        arrowPathBack.setAttribute('fill', '#ef4444');
        markerBack.appendChild(arrowPathBack);
        defs.appendChild(markerBack);

        // Glow filter
        const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
        filter.setAttribute('id', 'glow');
        filter.setAttribute('x', '-30%');
        filter.setAttribute('y', '-30%');
        filter.setAttribute('width', '160%');
        filter.setAttribute('height', '160%');
        const feGauss = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur');
        feGauss.setAttribute('stdDeviation', '4');
        feGauss.setAttribute('result', 'coloredBlur');
        filter.appendChild(feGauss);
        const feMerge = document.createElementNS('http://www.w3.org/2000/svg', 'feMerge');
        const feMergeNode1 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
        feMergeNode1.setAttribute('in', 'coloredBlur');
        feMerge.appendChild(feMergeNode1);
        const feMergeNode2 = document.createElementNS('http://www.w3.org/2000/svg', 'feMergeNode');
        feMergeNode2.setAttribute('in', 'SourceGraphic');
        feMerge.appendChild(feMergeNode2);
        filter.appendChild(feMerge);
        defs.appendChild(filter);

        // Create colored arrow markers for each node type
        const markerColors = {
            'arrowhead-violet': '#7c3aed',
            'arrowhead-red': '#ef4444',
            'arrowhead-blue': '#3b82f6',
            'arrowhead-amber': '#f59e0b',
            'arrowhead-cyan': '#06b6d4',
            'arrowhead-indigo': '#818cf8',
            'arrowhead-purple': '#8b5cf6',
        };

        for (const [id, color] of Object.entries(markerColors)) {
            const m = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            m.setAttribute('id', id);
            m.setAttribute('markerWidth', '12');
            m.setAttribute('markerHeight', '8');
            m.setAttribute('refX', '11');
            m.setAttribute('refY', '4');
            m.setAttribute('orient', 'auto');
            m.setAttribute('markerUnits', 'userSpaceOnUse');
            const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            p.setAttribute('d', 'M0,0 L12,4 L0,8 L3,4 Z');
            p.setAttribute('fill', color);
            m.appendChild(p);
            defs.appendChild(m);
        }

        this.svg.appendChild(defs);
    }

    // ═══ Render ══════════════════════════════════════════════════════════════

    render(parsedData) {
        this.nodes = parsedData.nodes.map(n => ({
            ...n,
            color: null,       // custom override
            shapeOverride: null // custom shape override
        }));
        this.edges = parsedData.edges.map(e => ({ ...e }));
        this.selectedNode = null;
        this.selectedEdge = null;

        this._saveUndoState();
        this._layoutNodes();
        this._drawAll();
        this._centerGraph();
    }

    // ═══ Auto Layout (Dagre-inspired) ════════════════════════════════════════

    _layoutNodes() {
        if (this.nodes.length === 0) return;

        // Measure all nodes
        for (const node of this.nodes) {
            const dims = this._measureNode(node);
            node.width = dims.width;
            node.height = dims.height;
        }

        const cfg = this.config;

        // ── Build adjacency from non-backref edges ──
        const forwardEdges = this.edges.filter(e => !e.isBackRef);

        // ── Topological level assignment (longest path) ──
        const level = new Map();
        const inDegree = new Map();
        for (const n of this.nodes) {
            level.set(n.id, 0);
            inDegree.set(n.id, 0);
        }

        // Count in-degrees for forward edges
        for (const e of forwardEdges) {
            inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
        }

        // Longest path BFS
        let changed = true;
        let iterations = 0;
        const maxIter = this.nodes.length * this.nodes.length + 10;
        while (changed && iterations < maxIter) {
            changed = false;
            iterations++;
            for (const edge of forwardEdges) {
                const fromLvl = level.get(edge.from);
                const toLvl = level.get(edge.to);
                if (fromLvl + 1 > toLvl) {
                    // Cycle guard
                    if (fromLvl + 1 > this.nodes.length) {
                        edge.isBackRef = true;
                        continue;
                    }
                    level.set(edge.to, fromLvl + 1);
                    changed = true;
                }
            }
        }

        // ── Build spanning tree ──
        const children = new Map();
        const parent = new Map();
        for (const n of this.nodes) children.set(n.id, []);

        for (const e of forwardEdges) {
            if (e.isBackRef) continue;
            if (!parent.has(e.to)) {
                parent.set(e.to, e.from);
                children.get(e.from).push(e.to);
            }
        }

        // ── Subtree widths ──
        const subtreeW = new Map();
        const calcW = (nid) => {
            const ch = children.get(nid);
            const nodeW = this.nodes.find(n => n.id === nid)?.width || cfg.nodeMaxWidth;
            if (!ch || ch.length === 0) {
                subtreeW.set(nid, nodeW + cfg.horizontalGap);
                return subtreeW.get(nid);
            }
            let totalW = 0;
            for (const c of ch) totalW += calcW(c);
            totalW = Math.max(nodeW + cfg.horizontalGap, totalW);
            subtreeW.set(nid, totalW);
            return totalW;
        };

        const roots = this.nodes.filter(n => !parent.has(n.id));
        if (roots.length === 0 && this.nodes.length > 0) roots.push(this.nodes[0]);
        roots.forEach(r => calcW(r.id));
        // Also calc for any orphans
        for (const n of this.nodes) {
            if (!subtreeW.has(n.id)) calcW(n.id);
        }

        // ── Assign X from subtree widths ──
        const xPos = new Map();
        const assignX = (nid, cx) => {
            xPos.set(nid, cx);
            const ch = children.get(nid);
            if (!ch || ch.length === 0) return;

            let totalChildW = ch.reduce((s, c) => s + subtreeW.get(c), 0);
            let startX = cx - totalChildW / 2;

            for (const c of ch) {
                const cw = subtreeW.get(c);
                assignX(c, startX + cw / 2);
                startX += cw;
            }
        };

        let totalRootW = roots.reduce((s, r) => s + (subtreeW.get(r.id) || 200), 0);
        let startRootX = -totalRootW / 2;
        for (const r of roots) {
            const rw = subtreeW.get(r.id) || 200;
            assignX(r.id, startRootX + rw / 2);
            startRootX += rw;
        }

        // Orphan fallback
        for (const n of this.nodes) {
            if (!xPos.has(n.id)) xPos.set(n.id, 0);
        }

        // ── Assign Y by level, fix overlaps ──
        const levelsMap = new Map();
        let maxLevel = 0;
        for (const node of this.nodes) {
            const l = level.get(node.id) || 0;
            maxLevel = Math.max(maxLevel, l);
            if (!levelsMap.has(l)) levelsMap.set(l, []);
            levelsMap.get(l).push(node);
        }

        let currentY = 60;
        for (let l = 0; l <= maxLevel; l++) {
            const nodesAtLevel = levelsMap.get(l) || [];
            nodesAtLevel.sort((a, b) => (xPos.get(a.id) || 0) - (xPos.get(b.id) || 0));

            // Push apart overlapping nodes
            for (let i = 1; i < nodesAtLevel.length; i++) {
                const prev = nodesAtLevel[i - 1];
                const curr = nodesAtLevel[i];
                const minDist = (prev.width / 2 + curr.width / 2) + cfg.horizontalGap;
                const actualDist = (xPos.get(curr.id) || 0) - (xPos.get(prev.id) || 0);
                if (actualDist < minDist) {
                    xPos.set(curr.id, (xPos.get(prev.id) || 0) + minDist);
                }
            }

            let maxH = 0;
            for (const node of nodesAtLevel) {
                node.x = (xPos.get(node.id) || 0) - node.width / 2;
                node.y = currentY;
                maxH = Math.max(maxH, node.height);
            }
            if (maxH > 0) currentY += maxH + cfg.verticalGap;
        }
    }

    _measureNode(node) {
        const cfg = this.config;

        if (node.type === 'connector') {
            return { width: cfg.connectorRadius * 2, height: cfg.connectorRadius * 2 };
        }
        if (node.type === 'decision') {
            const textLen = (node.text || '').length;
            const w = Math.max(cfg.decisionWidth, textLen * 6 + 60);
            return { width: w, height: Math.max(cfg.decisionHeight, w * 0.65) };
        }
        if (node.type === 'sub_block') {
            return { width: cfg.subBlockWidth, height: cfg.subBlockHeight };
        }

        const charW = (node.text || '').length * 7.5 + cfg.nodePadding * 2;
        const width = Math.min(Math.max(charW, cfg.nodeMinWidth), cfg.nodeMaxWidth);

        if (node.type === 'terminator_start' || node.type === 'terminator_end' || node.type === 'terminator') {
            return { width, height: cfg.terminatorHeight };
        }
        if (node.type === 'io') {
            return { width: width + cfg.ioSkew * 2, height: cfg.nodeHeight };
        }
        return { width, height: cfg.nodeHeight };
    }

    // ═══ Drawing ═════════════════════════════════════════════════════════════

    _drawAll() {
        // Clear layers
        this.edgeLayer.innerHTML = '';
        this.nodeLayer.innerHTML = '';

        // Draw edges
        for (const edge of this.edges) {
            this._drawEdge(edge);
        }

        // Draw nodes
        for (const node of this.nodes) {
            this._drawNode(node);
        }
    }

    _drawNode(node) {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'node-group');
        g.setAttribute('data-node-id', node.id);
        g.style.cursor = 'pointer';

        const effectiveType = node.shapeOverride || node.type;
        const colors = node.color
            ? { bg: node.color.bg || '#111827', border: node.color.border || '#3b82f6', text: node.color.text || '#bfdbfe', glow: node.color.glow || 'rgba(59,130,246,0.25)' }
            : (this.config.colors[effectiveType] || this.config.colors.process);

        let shape;
        switch (effectiveType) {
            case 'terminator':
            case 'terminator_start':
            case 'terminator_end':
                shape = this._createTerminatorShape(node, colors);
                break;
            case 'decision':
                shape = this._createDecisionShape(node, colors);
                break;
            case 'io':
                shape = this._createIOShape(node, colors);
                break;
            case 'connector':
                shape = this._createConnectorShape(node, colors);
                break;
            case 'sub_block':
                shape = this._createSubBlockShape(node, colors);
                break;
            default:
                shape = this._createProcessShape(node, colors);
        }

        g.appendChild(shape);

        // Text
        if (node.type !== 'connector') {
            const textEl = this._createTextElement(node, colors);
            g.appendChild(textEl);
        }

        // Selection highlight
        if (this.selectedNode && this.selectedNode.id === node.id) {
            const selRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            selRect.setAttribute('x', node.x - 4);
            selRect.setAttribute('y', node.y - 4);
            selRect.setAttribute('width', node.width + 8);
            selRect.setAttribute('height', node.height + 8);
            selRect.setAttribute('rx', '12');
            selRect.setAttribute('fill', 'none');
            selRect.setAttribute('stroke', '#fff');
            selRect.setAttribute('stroke-width', '2');
            selRect.setAttribute('stroke-dasharray', '6,3');
            selRect.setAttribute('class', 'selection-indicator');
            g.insertBefore(selRect, g.firstChild);
        }

        this.nodeLayer.appendChild(g);
    }

    _createTerminatorShape(node, colors) {
        const { x, y, width, height } = node;
        const r = height / 2;
        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        shape.setAttribute('x', x);
        shape.setAttribute('y', y);
        shape.setAttribute('width', width);
        shape.setAttribute('height', height);
        shape.setAttribute('rx', r);
        shape.setAttribute('ry', r);
        shape.setAttribute('fill', colors.bg);
        shape.setAttribute('stroke', colors.border);
        shape.setAttribute('stroke-width', '2');
        shape.setAttribute('filter', 'url(#glow)');
        return shape;
    }

    _createProcessShape(node, colors) {
        const { x, y, width, height } = node;
        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        shape.setAttribute('x', x);
        shape.setAttribute('y', y);
        shape.setAttribute('width', width);
        shape.setAttribute('height', height);
        shape.setAttribute('rx', '10');
        shape.setAttribute('ry', '10');
        shape.setAttribute('fill', colors.bg);
        shape.setAttribute('stroke', colors.border);
        shape.setAttribute('stroke-width', '2');
        shape.setAttribute('filter', 'url(#glow)');
        return shape;
    }

    _createDecisionShape(node, colors) {
        const { x, y, width, height } = node;
        const cx = x + width / 2;
        const cy = y + height / 2;
        const points = `${cx},${y} ${x + width},${cy} ${cx},${y + height} ${x},${cy}`;
        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        shape.setAttribute('points', points);
        shape.setAttribute('fill', colors.bg);
        shape.setAttribute('stroke', colors.border);
        shape.setAttribute('stroke-width', '2');
        shape.setAttribute('filter', 'url(#glow)');
        return shape;
    }

    _createIOShape(node, colors) {
        const { x, y, width, height } = node;
        const sk = this.config.ioSkew;
        const points = `${x + sk},${y} ${x + width},${y} ${x + width - sk},${y + height} ${x},${y + height}`;
        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        shape.setAttribute('points', points);
        shape.setAttribute('fill', colors.bg);
        shape.setAttribute('stroke', colors.border);
        shape.setAttribute('stroke-width', '2');
        shape.setAttribute('filter', 'url(#glow)');
        return shape;
    }

    _createConnectorShape(node, colors) {
        const r = this.config.connectorRadius;
        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        shape.setAttribute('cx', node.x + r);
        shape.setAttribute('cy', node.y + r);
        shape.setAttribute('r', r);
        shape.setAttribute('fill', colors.bg);
        shape.setAttribute('stroke', colors.border);
        shape.setAttribute('stroke-width', '2');
        shape.setAttribute('filter', 'url(#glow)');
        return shape;
    }

    _createSubBlockShape(node, colors) {
        const { x, y, width, height } = node;
        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        shape.setAttribute('x', x);
        shape.setAttribute('y', y);
        shape.setAttribute('width', width);
        shape.setAttribute('height', height);
        shape.setAttribute('rx', '10');
        shape.setAttribute('ry', '10');
        shape.setAttribute('fill', colors.bg);
        shape.setAttribute('stroke', colors.border);
        shape.setAttribute('stroke-width', '2');
        shape.setAttribute('filter', 'url(#glow)');
        return shape;
    }

    _createTextElement(node, colors) {
        const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        textEl.setAttribute('x', node.x + node.width / 2);
        textEl.setAttribute('y', node.y + node.height / 2);
        textEl.setAttribute('text-anchor', 'middle');
        textEl.setAttribute('dominant-baseline', 'central');
        textEl.setAttribute('fill', colors.text);
        textEl.setAttribute('font-family', 'Inter, system-ui, sans-serif');
        textEl.setAttribute('font-size', node.type === 'decision' ? '12' : '13');
        textEl.setAttribute('font-weight', '500');
        textEl.setAttribute('pointer-events', 'none');

        // Word wrap for long text
        const maxWidth = node.type === 'decision' ? node.width * 0.55 : node.width - 20;
        const words = (node.text || '').split(' ');
        const lines = [];
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine ? currentLine + ' ' + word : word;
            if (testLine.length * 7 > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines.push(currentLine);

        if (lines.length <= 1) {
            textEl.textContent = node.text || '';
        } else {
            const lineHeight = 16;
            const startDy = -((lines.length - 1) * lineHeight) / 2;
            for (let i = 0; i < lines.length; i++) {
                const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                tspan.setAttribute('x', node.x + node.width / 2);
                tspan.setAttribute('dy', i === 0 ? startDy : lineHeight);
                tspan.textContent = lines[i];
                textEl.appendChild(tspan);
            }
        }

        return textEl;
    }

    // ── Edge Drawing ──────────────────────────────────────────────────────

    _drawEdge(edge) {
        const fromNode = this.nodes.find(n => n.id === edge.from);
        const toNode = this.nodes.find(n => n.id === edge.to);
        if (!fromNode || !toNode) return;

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'edge-group');
        g.setAttribute('data-edge-from', edge.from);
        g.setAttribute('data-edge-to', edge.to);

        const from = this._getAnchor(fromNode, 'bottom');
        const to = this._getAnchor(toNode, 'top');

        // Calculate anchor offsets for parallel edges
        const outgoing = this.edges.filter(e => e.from === edge.from && !e.isBackRef);
        const incoming = this.edges.filter(e => e.to === edge.to && !e.isBackRef);

        if (outgoing.length > 1) {
            const idx = outgoing.indexOf(edge);
            const spread = 20;
            const offset = (idx - (outgoing.length - 1) / 2) * spread;
            from.x += offset;
        }
        if (incoming.length > 1) {
            const idx = incoming.indexOf(edge);
            const spread = 20;
            const offset = (idx - (incoming.length - 1) / 2) * spread;
            to.x += offset;
        }

        let pathD;
        let arrowColor = this.config.arrowColor;
        let markerId = 'arrowhead';

        if (edge.isBackRef) {
            // Route back-ref arrows around the left side
            const backrefs = this.edges.filter(e => e.isBackRef);
            const backIdx = backrefs.indexOf(edge);
            const stagger = backIdx * 20;

            let minX = Math.min(from.x, to.x);
            for (const n of this.nodes) {
                const ny = n.y;
                const nyb = n.y + n.height;
                const minY = Math.min(from.y, to.y);
                const maxY = Math.max(from.y, to.y);
                if (nyb >= minY && ny <= maxY) {
                    minX = Math.min(minX, n.x);
                }
            }
            minX -= 50 + stagger;

            pathD = `M${from.x},${from.y} L${from.x},${from.y + 20} L${minX},${from.y + 20} L${minX},${to.y - 20} L${to.x},${to.y - 20} L${to.x},${to.y}`;

            const tgtColors = this.config.colors[toNode.type] || this.config.colors.process;
            arrowColor = tgtColors.border;
            markerId = this._getMarkerIdForColor(arrowColor);
        } else {
            const dx = to.x - from.x;
            const dy = to.y - from.y;

            if (Math.abs(dx) < 5) {
                // Straight down
                pathD = `M${from.x},${from.y} L${to.x},${to.y}`;
            } else if (dy < 0) {
                // Going upward
                pathD = `M${from.x},${from.y} C${from.x},${from.y + 40} ${to.x},${to.y - 40} ${to.x},${to.y}`;
            } else {
                // Normal curved path
                const curveOffset = Math.max(30, dy * 0.4);
                pathD = `M${from.x},${from.y} C${from.x},${from.y + curveOffset} ${to.x},${to.y - curveOffset} ${to.x},${to.y}`;
            }
        }

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathD);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', arrowColor);
        path.setAttribute('stroke-width', '2');
        path.setAttribute('marker-end', `url(#${markerId})`);
        path.setAttribute('class', 'edge-path');
        if (edge.isBackRef) {
            path.setAttribute('stroke-dasharray', '6,4');
        }
        g.appendChild(path);

        // Invisible wider path for easier clicking
        const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitPath.setAttribute('d', pathD);
        hitPath.setAttribute('fill', 'none');
        hitPath.setAttribute('stroke', 'transparent');
        hitPath.setAttribute('stroke-width', '14');
        hitPath.setAttribute('class', 'edge-hit-area');
        hitPath.style.cursor = 'pointer';
        g.appendChild(hitPath);

        // Edge label
        if (edge.label) {
            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2;

            // Label bg
            const labelBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            const labelW = edge.label.length * 7 + 16;
            labelBg.setAttribute('x', midX - labelW / 2);
            labelBg.setAttribute('y', midY - 10);
            labelBg.setAttribute('width', labelW);
            labelBg.setAttribute('height', 20);
            labelBg.setAttribute('rx', '6');
            labelBg.setAttribute('fill', 'rgba(10,10,15,0.9)');
            labelBg.setAttribute('stroke', 'rgba(255,255,255,0.1)');
            labelBg.setAttribute('stroke-width', '1');
            g.appendChild(labelBg);

            const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            labelText.setAttribute('x', midX);
            labelText.setAttribute('y', midY);
            labelText.setAttribute('text-anchor', 'middle');
            labelText.setAttribute('dominant-baseline', 'central');
            labelText.setAttribute('fill', this.config.arrowLabelColor);
            labelText.setAttribute('font-family', 'Inter, system-ui, sans-serif');
            labelText.setAttribute('font-size', '11');
            labelText.setAttribute('font-weight', '500');
            labelText.textContent = edge.label;
            g.appendChild(labelText);
        }

        // Selection indicator
        if (this.selectedEdge && this.selectedEdge.from === edge.from && this.selectedEdge.to === edge.to) {
            path.setAttribute('stroke', '#fff');
            path.setAttribute('stroke-width', '3');
        }

        this.edgeLayer.appendChild(g);
    }

    _getMarkerIdForColor(color) {
        const colorMap = {
            '#7c3aed': 'arrowhead-violet',
            '#ef4444': 'arrowhead-red',
            '#3b82f6': 'arrowhead-blue',
            '#f59e0b': 'arrowhead-amber',
            '#06b6d4': 'arrowhead-cyan',
            '#818cf8': 'arrowhead-indigo',
            '#8b5cf6': 'arrowhead-purple',
        };
        return colorMap[color] || 'arrowhead';
    }

    _getAnchor(node, position) {
        const cx = node.x + node.width / 2;
        const cy = node.y + node.height / 2;

        switch (position) {
            case 'top': return { x: cx, y: node.y };
            case 'bottom': return { x: cx, y: node.y + node.height };
            case 'left': return { x: node.x, y: cy };
            case 'right': return { x: node.x + node.width, y: cy };
            default: return { x: cx, y: cy };
        }
    }

    // ═══ Pan/Zoom/Interaction ════════════════════════════════════════════════

    _setupInteraction() {
        let isPanning = false;
        let lastPanX = 0, lastPanY = 0;
        let didPan = false;

        // ── Wheel zoom ──
        this.svg.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY > 0 ? 0.92 : 1.08;
            const rect = this.svg.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            this.offsetX = mx - (mx - this.offsetX) * zoomFactor;
            this.offsetY = my - (my - this.offsetY) * zoomFactor;
            this.scale *= zoomFactor;
            this.scale = Math.max(0.15, Math.min(5, this.scale));

            this._applyTransform();
            this._fireZoomChange();
        }, { passive: false });

        // ── Mouse interactions ──
        this.svg.addEventListener('mousedown', (e) => {
            const nodeGroup = e.target.closest('.node-group');
            const edgeGroup = e.target.closest('.edge-group');

            if (nodeGroup && !e.shiftKey) {
                // Start dragging node
                const nodeId = parseInt(nodeGroup.dataset.nodeId);
                const node = this.nodes.find(n => n.id === nodeId);
                if (node) {
                    this.isDragging = true;
                    this.dragNode = node;
                    const rect = this.svg.getBoundingClientRect();
                    this.dragStartX = (e.clientX - rect.left - this.offsetX) / this.scale;
                    this.dragStartY = (e.clientY - rect.top - this.offsetY) / this.scale;
                    this.nodeStartX = node.x;
                    this.nodeStartY = node.y;
                    didPan = false;
                    e.preventDefault();
                    return;
                }
            }

            if (edgeGroup) {
                const from = parseInt(edgeGroup.dataset.edgeFrom);
                const to = parseInt(edgeGroup.dataset.edgeTo);
                const edge = this.edges.find(e => e.from === from && e.to === to);
                if (edge) {
                    this.selectedEdge = edge;
                    this.selectedNode = null;
                    this._drawAll();
                    this._fireSelectionChange();
                    return;
                }
            }

            // Pan
            isPanning = true;
            didPan = false;
            lastPanX = e.clientX;
            lastPanY = e.clientY;
            this.svg.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (e) => {
            if (this.isDragging && this.dragNode) {
                const rect = this.svg.getBoundingClientRect();
                const mx = (e.clientX - rect.left - this.offsetX) / this.scale;
                const my = (e.clientY - rect.top - this.offsetY) / this.scale;
                const dx = mx - this.dragStartX;
                const dy = my - this.dragStartY;

                this.dragNode.x = this.nodeStartX + dx;
                this.dragNode.y = this.nodeStartY + dy;
                this._drawAll();
                return;
            }

            if (!isPanning) return;
            const dx = e.clientX - lastPanX;
            const dy = e.clientY - lastPanY;
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didPan = true;
            this.offsetX += dx;
            this.offsetY += dy;
            lastPanX = e.clientX;
            lastPanY = e.clientY;
            this._applyTransform();
        });

        window.addEventListener('mouseup', (e) => {
            if (this.isDragging && this.dragNode) {
                // Save undo state after drag
                if (this.dragNode.x !== this.nodeStartX || this.dragNode.y !== this.nodeStartY) {
                    this._saveUndoState();
                }
                this.isDragging = false;
                this.dragNode = null;
                return;
            }

            isPanning = false;
            this.svg.style.cursor = 'grab';

            if (!didPan && e.target === this.svg) {
                // Click on empty space: deselect
                this.selectedNode = null;
                this.selectedEdge = null;
                this._drawAll();
                this._fireSelectionChange();
            }
        });

        // ── Click to select node ──
        this.svg.addEventListener('click', (e) => {
            if (didPan) return;

            const nodeGroup = e.target.closest('.node-group');
            if (nodeGroup) {
                const nodeId = parseInt(nodeGroup.dataset.nodeId);
                const node = this.nodes.find(n => n.id === nodeId);
                if (node) {
                    this.selectedNode = node;
                    this.selectedEdge = null;
                    this._drawAll();
                    this._fireSelectionChange();
                }
            }
        });

        // ── Double-click to edit text ──
        this.svg.addEventListener('dblclick', (e) => {
            const nodeGroup = e.target.closest('.node-group');
            if (nodeGroup) {
                const nodeId = parseInt(nodeGroup.dataset.nodeId);
                const node = this.nodes.find(n => n.id === nodeId);
                if (node && node.type !== 'connector') {
                    this._startInlineEdit(node);
                }
                return;
            }

            const edgeGroup = e.target.closest('.edge-group');
            if (edgeGroup) {
                const from = parseInt(edgeGroup.dataset.edgeFrom);
                const to = parseInt(edgeGroup.dataset.edgeTo);
                const edge = this.edges.find(e => e.from === from && e.to === to);
                if (edge) {
                    this._editEdgeLabel(edge);
                }
            }
        });

        // ── Keyboard shortcuts ──
        document.addEventListener('keydown', (e) => {
            // Only handle if the canvas area is focused (no input/textarea focused)
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                this.undo();
            }
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault();
                this.redo();
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (this.selectedNode) {
                    e.preventDefault();
                    this.deleteSelectedNode();
                } else if (this.selectedEdge) {
                    e.preventDefault();
                    this.deleteSelectedEdge();
                }
            }
        });
    }

    _applyTransform() {
        this.mainGroup.setAttribute('transform', `translate(${this.offsetX},${this.offsetY}) scale(${this.scale})`);
    }

    _centerGraph() {
        if (this.nodes.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of this.nodes) {
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + n.width);
            maxY = Math.max(maxY, n.y + n.height);
        }

        const graphW = maxX - minX;
        const graphH = maxY - minY;
        const containerW = this.container.clientWidth;
        const containerH = this.container.clientHeight;

        const scaleX = (containerW - 100) / graphW;
        const scaleY = (containerH - 100) / graphH;
        this.scale = Math.min(scaleX, scaleY, 1.5);
        this.scale = Math.max(this.scale, 0.3);

        this.offsetX = (containerW - graphW * this.scale) / 2 - minX * this.scale;
        this.offsetY = (containerH - graphH * this.scale) / 2 - minY * this.scale;

        this._applyTransform();
        this._fireZoomChange();
    }

    // ═══ Inline Editing ═════════════════════════════════════════════════════

    _startInlineEdit(node) {
        // Create a foreign object overlay for inline text editing
        const rect = this.svg.getBoundingClientRect();
        const screenX = node.x * this.scale + this.offsetX + rect.left;
        const screenY = node.y * this.scale + this.offsetY + rect.top;
        const screenW = node.width * this.scale;
        const screenH = node.height * this.scale;

        const input = document.createElement('textarea');
        input.value = node.text;
        input.className = 'inline-editor';
        input.style.cssText = `
            position: fixed;
            left: ${screenX}px;
            top: ${screenY}px;
            width: ${screenW}px;
            height: ${screenH}px;
            min-height: 40px;
            z-index: 10000;
            background: rgba(17, 24, 39, 0.95);
            border: 2px solid #6366f1;
            color: #e0e0ff;
            font-family: Inter, system-ui, sans-serif;
            font-size: ${13 * this.scale}px;
            text-align: center;
            padding: 8px;
            border-radius: 8px;
            outline: none;
            resize: none;
            box-shadow: 0 0 20px rgba(99, 102, 241, 0.4);
        `;

        document.body.appendChild(input);
        input.focus();
        input.select();

        const commit = () => {
            const newText = input.value.trim();
            if (newText && newText !== node.text) {
                const oldText = node.text;
                node.text = newText;
                // Re-measure
                const dims = this._measureNode(node);
                node.width = dims.width;
                node.height = dims.height;
                this._saveUndoState();
                this._drawAll();

                // Fire event for app.js to sync code
                const event = new CustomEvent('nodeedit', {
                    detail: { node, oldText, newText }
                });
                this.svg.dispatchEvent(event);
            }
            input.remove();
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commit();
            }
            if (e.key === 'Escape') {
                input.remove();
            }
        });
    }

    _editEdgeLabel(edge) {
        const fromNode = this.nodes.find(n => n.id === edge.from);
        const toNode = this.nodes.find(n => n.id === edge.to);
        if (!fromNode || !toNode) return;

        const newLabel = prompt('Edit arrow label:', edge.label || '');
        if (newLabel !== null) {
            edge.label = newLabel.trim() || null;
            this._saveUndoState();
            this._drawAll();
        }
    }

    // ═══ Undo / Redo ════════════════════════════════════════════════════════

    _saveUndoState() {
        const state = {
            nodes: this.nodes.map(n => ({ ...n, color: n.color ? { ...n.color } : null })),
            edges: this.edges.map(e => ({ ...e }))
        };
        this.undoStack.push(JSON.stringify(state));
        if (this.undoStack.length > this.maxUndoSteps) this.undoStack.shift();
        this.redoStack = [];

        // Dispatch event for undo/redo button state
        this.svg.dispatchEvent(new CustomEvent('historystatechange', {
            detail: { canUndo: this.undoStack.length > 1, canRedo: this.redoStack.length > 0 }
        }));
    }

    undo() {
        if (this.undoStack.length <= 1) return;
        const current = this.undoStack.pop();
        this.redoStack.push(current);

        const prevState = JSON.parse(this.undoStack[this.undoStack.length - 1]);
        this.nodes = prevState.nodes;
        this.edges = prevState.edges;
        this.selectedNode = null;
        this.selectedEdge = null;
        this._drawAll();
        this._fireSelectionChange();

        this.svg.dispatchEvent(new CustomEvent('historystatechange', {
            detail: { canUndo: this.undoStack.length > 1, canRedo: this.redoStack.length > 0 }
        }));
    }

    redo() {
        if (this.redoStack.length === 0) return;
        const state = this.redoStack.pop();
        this.undoStack.push(state);

        const restoredState = JSON.parse(state);
        this.nodes = restoredState.nodes;
        this.edges = restoredState.edges;
        this.selectedNode = null;
        this.selectedEdge = null;
        this._drawAll();
        this._fireSelectionChange();

        this.svg.dispatchEvent(new CustomEvent('historystatechange', {
            detail: { canUndo: this.undoStack.length > 1, canRedo: this.redoStack.length > 0 }
        }));
    }

    // ═══ Node/Edge Operations ════════════════════════════════════════════════

    deleteSelectedNode() {
        if (!this.selectedNode) return;
        const id = this.selectedNode.id;
        this.nodes = this.nodes.filter(n => n.id !== id);
        this.edges = this.edges.filter(e => e.from !== id && e.to !== id);
        this.selectedNode = null;
        this._saveUndoState();
        this._drawAll();
        this._fireSelectionChange();
        this._fireDataChange();
    }

    deleteSelectedEdge() {
        if (!this.selectedEdge) return;
        const from = this.selectedEdge.from;
        const to = this.selectedEdge.to;
        this.edges = this.edges.filter(e => !(e.from === from && e.to === to));
        this.selectedEdge = null;
        this._saveUndoState();
        this._drawAll();
        this._fireSelectionChange();
        this._fireDataChange();
    }

    changeNodeShape(nodeId, newShape) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;
        node.shapeOverride = newShape;
        const dims = this._measureNode(node);
        node.width = dims.width;
        node.height = dims.height;
        this._saveUndoState();
        this._drawAll();
    }

    changeNodeColor(nodeId, colorPreset) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const presets = {
            blue: { bg: '#111827', border: '#3b82f6', text: '#bfdbfe', glow: 'rgba(59,130,246,0.25)' },
            violet: { bg: '#1a1a2e', border: '#7c3aed', text: '#e0e0ff', glow: 'rgba(124,58,237,0.3)' },
            red: { bg: '#1a1a2e', border: '#ef4444', text: '#fecaca', glow: 'rgba(239,68,68,0.3)' },
            amber: { bg: '#1c1917', border: '#f59e0b', text: '#fde68a', glow: 'rgba(245,158,11,0.25)' },
            cyan: { bg: '#0f172a', border: '#06b6d4', text: '#a5f3fc', glow: 'rgba(6,182,212,0.25)' },
            green: { bg: '#052e16', border: '#22c55e', text: '#bbf7d0', glow: 'rgba(34,197,94,0.25)' },
            pink: { bg: '#1a0a1e', border: '#ec4899', text: '#fbcfe8', glow: 'rgba(236,72,153,0.25)' },
            reset: null
        };

        node.color = presets[colorPreset] || null;
        this._saveUndoState();
        this._drawAll();
    }

    resizeNode(nodeId, widthDelta, heightDelta) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (!node) return;
        node.width = Math.max(80, node.width + widthDelta);
        node.height = Math.max(30, node.height + heightDelta);
        this._saveUndoState();
        this._drawAll();
    }

    // ═══ Auto Re-layout ═════════════════════════════════════════════════════

    autoLayout() {
        this._layoutNodes();
        this._saveUndoState();
        this._drawAll();
        this._centerGraph();
    }

    // ═══ Event Helpers ══════════════════════════════════════════════════════

    _fireZoomChange() {
        this.svg.dispatchEvent(new CustomEvent('zoomchange', { detail: { scale: this.scale } }));
    }

    _fireSelectionChange() {
        this.svg.dispatchEvent(new CustomEvent('selectionchange', {
            detail: { node: this.selectedNode, edge: this.selectedEdge }
        }));
    }

    _fireDataChange() {
        this.svg.dispatchEvent(new CustomEvent('datachange', {
            detail: { nodes: this.nodes, edges: this.edges }
        }));
    }

    // ═══ Zoom Controls ══════════════════════════════════════════════════════

    zoomIn() {
        this.scale *= 1.2;
        this.scale = Math.min(5, this.scale);
        this._applyTransform();
        this._fireZoomChange();
    }

    zoomOut() {
        this.scale *= 0.83;
        this.scale = Math.max(0.15, this.scale);
        this._applyTransform();
        this._fireZoomChange();
    }

    fitToScreen() {
        this._centerGraph();
    }

    // ═══ Export ══════════════════════════════════════════════════════════════

    exportPNG() {
        const bounds = this._getGraphBounds();
        const padding = 60;
        const w = bounds.width + padding * 2;
        const h = bounds.height + padding * 2;

        const canvas = document.createElement('canvas');
        canvas.width = w * 2;
        canvas.height = h * 2;
        const ctx = canvas.getContext('2d');
        ctx.scale(2, 2);

        // Dark background
        ctx.fillStyle = '#0a0a0f';
        ctx.fillRect(0, 0, w, h);

        // Serialize SVG
        const svgClone = this.svg.cloneNode(true);
        svgClone.setAttribute('width', w);
        svgClone.setAttribute('height', h);
        const mainG = svgClone.querySelector('.main-group');
        if (mainG) {
            mainG.setAttribute('transform', `translate(${padding - bounds.minX}, ${padding - bounds.minY}) scale(1)`);
        }

        const svgData = new XMLSerializer().serializeToString(svgClone);
        const img = new Image();
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);

        return new Promise((resolve) => {
            img.onload = () => {
                ctx.drawImage(img, 0, 0, w, h);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                // Fallback: serialize inline
                resolve(canvas.toDataURL('image/png'));
            };
            img.src = url;
        });
    }

    exportSVG() {
        const bounds = this._getGraphBounds();
        const padding = 60;
        const w = bounds.width + padding * 2;
        const h = bounds.height + padding * 2;

        const svgClone = this.svg.cloneNode(true);
        svgClone.setAttribute('width', w);
        svgClone.setAttribute('height', h);
        svgClone.setAttribute('viewBox', `0 0 ${w} ${h}`);
        svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

        // Add background
        const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('width', w);
        bgRect.setAttribute('height', h);
        bgRect.setAttribute('fill', '#0a0a0f');
        svgClone.insertBefore(bgRect, svgClone.firstChild);

        const mainG = svgClone.querySelector('.main-group');
        if (mainG) {
            mainG.setAttribute('transform', `translate(${padding - bounds.minX}, ${padding - bounds.minY}) scale(1)`);
        }

        return new XMLSerializer().serializeToString(svgClone);
    }

    _getGraphBounds() {
        if (this.nodes.length === 0) return { minX: 0, minY: 0, width: 400, height: 300 };

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of this.nodes) {
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + n.width);
            maxY = Math.max(maxY, n.y + n.height);
        }

        return { minX, minY, width: maxX - minX, height: maxY - minY };
    }
}

window.FlowchartRenderer = FlowchartRenderer;
