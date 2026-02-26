/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FlowChart Canvas Renderer
 *  Renders the parsed Bridge Language AST onto an HTML Canvas
 *  with auto-layout, smooth edges, and premium styling.
 * ═══════════════════════════════════════════════════════════════════════════
 */

class FlowchartRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        // ── Pan & Zoom ──────────────────────────────────────────────────
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.isPanning = false;
        this.lastPanX = 0;
        this.lastPanY = 0;

        // ── Layout Config ───────────────────────────────────────────────
        this.config = {
            nodeMinWidth: 180,
            nodeMaxWidth: 280,
            nodeHeight: 52,
            nodePadding: 20,
            decisionSize: 90,
            terminatorHeight: 46,
            ioSkew: 16,
            connectorRadius: 16,
            subBlockWidth: 240,
            subBlockHeight: 100,

            horizontalGap: 80,
            verticalGap: 60,
            arrowColor: '#6366f1',
            arrowLabelColor: '#a5b4fc',
            arrowWidth: 2,
            arrowHeadSize: 10,

            colors: {
                terminator: { bg: '#1a1a2e', border: '#7c3aed', text: '#e0e0ff', glow: 'rgba(124,58,237,0.2)' },
                terminator_start: { bg: '#1a1a2e', border: '#7c3aed', text: '#e0e0ff', glow: 'rgba(124,58,237,0.2)' },
                terminator_end: { bg: '#1a1a2e', border: '#ef4444', text: '#fecaca', glow: 'rgba(239,68,68,0.2)' },
                process: { bg: '#111827', border: '#3b82f6', text: '#bfdbfe', glow: 'rgba(59,130,246,0.15)' },
                decision: { bg: '#1c1917', border: '#f59e0b', text: '#fde68a', glow: 'rgba(245,158,11,0.15)' },
                io: { bg: '#0f172a', border: '#06b6d4', text: '#a5f3fc', glow: 'rgba(6,182,212,0.15)' },
                connector: { bg: '#1e1b4b', border: '#818cf8', text: '#c7d2fe', glow: 'rgba(129,140,248,0.15)' },
                sub_block: { bg: '#1a1a2e', border: '#8b5cf6', text: '#ddd6fe', glow: 'rgba(139,92,246,0.15)' }
            },

            font: '500 13px Inter, sans-serif',
            smallFont: '400 11px Inter, sans-serif',
            labelFont: '500 11px Inter, sans-serif',
        };

        // ── Internal State ──────────────────────────────────────────────
        this.nodes = [];
        this.edges = [];

        this._setupInteraction();
    }

    /**
     * Render a parsed graph
     */
    render(parsedData) {
        this.nodes = parsedData.nodes.map(n => ({ ...n }));
        this.edges = parsedData.edges.map(e => ({ ...e }));

        this._layoutNodes();
        this._resizeCanvas();
        this._draw();
    }

    /**
     * Auto-layout: assign x, y positions to all nodes.
     * Uses a simple top-to-bottom flow, with branching handled by horizontal offsets.
     */
    _layoutNodes() {
        if (this.nodes.length === 0) return;

        const cfg = this.config;
        this.ctx.font = cfg.font;
        for (const node of this.nodes) {
            const dims = this._measureNode(node);
            node.width = dims.width;
            node.height = dims.height;
        }

        // Longest-path Level Assignment (DAG)
        const level = new Map();
        for (const n of this.nodes) level.set(n.id, 0);

        let changed = true;
        while (changed) {
            changed = false;
            for (const edge of this.edges) {
                if (edge.isBackRef) continue;
                const parentLvl = level.get(edge.from);
                const childLvl = level.get(edge.to);
                if (parentLvl + 1 > childLvl) {
                    if (parentLvl + 1 > this.nodes.length) {
                        edge.isBackRef = true; // Cycle detected dynamically
                        continue;
                    }
                    level.set(edge.to, parentLvl + 1);
                    changed = true;
                }
            }
        }

        // Build Tree structure for parallel layout branching
        const primaryParent = new Map();
        const childLists = new Map();
        for (const node of this.nodes) childLists.set(node.id, []);

        for (const edge of this.edges) {
            if (edge.isBackRef) continue;
            if (!primaryParent.has(edge.to)) {
                primaryParent.set(edge.to, edge.from);
                childLists.get(edge.from).push(edge.to);
            }
        }

        // Recursive subtree width calculation
        const subtreeWidth = new Map();
        const calcWidth = (nid) => {
            const children = childLists.get(nid);
            if (children.length === 0) {
                const w = cfg.nodeMaxWidth;
                subtreeWidth.set(nid, w);
                return w;
            }
            let w = 0;
            for (const c of children) {
                w += calcWidth(c);
            }
            w += (children.length - 1) * cfg.horizontalGap;
            const finalW = Math.max(cfg.nodeMaxWidth, w);
            subtreeWidth.set(nid, finalW);
            return finalW;
        };

        const roots = this.nodes.filter(n => !primaryParent.has(n.id));
        if (roots.length === 0 && this.nodes.length > 0) roots.push(this.nodes[0]);
        roots.forEach(r => calcWidth(r.id));

        // Assign X coordinates hierarchically to force parallel streams
        const assignedX = new Map();
        const assignX = (nid, baseX) => {
            assignedX.set(nid, baseX);
            const children = childLists.get(nid);
            if (children.length === 0) return;

            const totalW = subtreeWidth.get(nid);
            let currentX = baseX - (totalW / 2);
            for (const c of children) {
                const cw = subtreeWidth.get(c);
                const centerOfChild = currentX + (cw / 2);
                assignX(c, centerOfChild);
                currentX += cw + cfg.horizontalGap;
            }
        };

        let totalRootW = roots.reduce((s, r) => s + subtreeWidth.get(r.id), 0) + (roots.length - 1) * cfg.horizontalGap;
        let startX = -(totalRootW / 2);
        for (const r of roots) {
            const rw = subtreeWidth.get(r.id);
            assignX(r.id, startX + (rw / 2));
            startX += rw + cfg.horizontalGap;
        }

        // Fallback for completely isolated nodes
        for (const n of this.nodes) {
            if (!assignedX.has(n.id)) assignedX.set(n.id, 0);
        }

        // Group by level and compute actual physical Y values
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

            // Push apart overlapping nodes intelligently if cross-edges caused crowding
            nodesAtLevel.sort((a, b) => assignedX.get(a.id) - assignedX.get(b.id));
            for (let i = 1; i < nodesAtLevel.length; i++) {
                const prev = nodesAtLevel[i - 1];
                const curr = nodesAtLevel[i];
                const minDistance = (prev.width / 2 + curr.width / 2) + cfg.horizontalGap;
                const actualDistance = assignedX.get(curr.id) - assignedX.get(prev.id);
                if (actualDistance < minDistance) {
                    assignedX.set(curr.id, assignedX.get(prev.id) + minDistance);
                }
            }

            let maxH = 0;
            for (const node of nodesAtLevel) {
                node.x = assignedX.get(node.id) - (node.width / 2);
                node.y = currentY;
                maxH = Math.max(maxH, node.height);
            }
            if (maxH > 0) currentY += maxH + cfg.verticalGap;
        }

        this._centerGraph();
    }

    /**
     * Center the graph in the visible canvas area
     */
    _centerGraph() {
        if (this.nodes.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const node of this.nodes) {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + node.width);
            maxY = Math.max(maxY, node.y + node.height);
        }

        const graphW = maxX - minX;
        const graphH = maxY - minY;
        const canvasW = this.canvas.parentElement.clientWidth;
        const canvasH = this.canvas.parentElement.clientHeight;

        // Calculate scale to fit
        const scaleX = (canvasW - 100) / graphW;
        const scaleY = (canvasH - 100) / graphH;
        this.scale = Math.min(scaleX, scaleY, 1.5);
        this.scale = Math.max(this.scale, 0.3);

        // Center
        this.offsetX = (canvasW - graphW * this.scale) / 2 - minX * this.scale;
        this.offsetY = (canvasH - graphH * this.scale) / 2 - minY * this.scale;
    }

    /**
     * Measure node dimensions
     */
    _measureNode(node) {
        const cfg = this.config;
        this.ctx.font = cfg.font;

        if (node.type === 'connector') {
            return { width: cfg.connectorRadius * 2, height: cfg.connectorRadius * 2 };
        }

        if (node.type === 'decision') {
            const textW = this.ctx.measureText(node.text).width;
            const size = Math.max(cfg.decisionSize, textW * 0.8 + 40);
            return { width: size, height: size * 0.7 };
        }

        if (node.type === 'sub_block') {
            let maxW = cfg.subBlockWidth;
            if (node.subBlocks) {
                const mkW = (t) => t ? this.ctx.measureText(t).width : 0;
                maxW = Math.max(maxW, mkW(node.subBlocks.tm) + 40);
                maxW = Math.max(maxW, mkW(node.subBlocks.bm) + 40);
                maxW = Math.max(maxW, mkW(node.subBlocks.tl) + mkW(node.subBlocks.tr) + 60);
                maxW = Math.max(maxW, mkW(node.subBlocks.bl) + mkW(node.subBlocks.br) + 60);
            }
            return { width: maxW, height: cfg.subBlockHeight };
        }

        const textW = this.ctx.measureText(node.text).width;
        const width = Math.min(Math.max(textW + cfg.nodePadding * 2, cfg.nodeMinWidth), cfg.nodeMaxWidth);

        if (node.type === 'terminator_start' || node.type === 'terminator_end') {
            return { width, height: cfg.terminatorHeight };
        }

        if (node.type === 'io') {
            return { width: width + cfg.ioSkew * 2, height: cfg.nodeHeight };
        }

        return { width, height: cfg.nodeHeight };
    }

    /**
     * Resize canvas to container
     */
    _resizeCanvas() {
        const container = this.canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = container.clientWidth * dpr;
        this.canvas.height = container.clientHeight * dpr;
        this.canvas.style.width = container.clientWidth + 'px';
        this.canvas.style.height = container.clientHeight + 'px';
        this.ctx.scale(dpr, dpr);
    }

    /**
     * Main draw call
     */
    _draw() {
        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;
        const w = this.canvas.width / dpr;
        const h = this.canvas.height / dpr;

        // Clear
        ctx.clearRect(0, 0, w, h);

        // Draw subtle grid
        this._drawGrid(w, h);

        // Apply transform
        ctx.save();
        ctx.translate(this.offsetX, this.offsetY);
        ctx.scale(this.scale, this.scale);

        // Pre-calculate edge anchor spread to avoid arrowhead overlapping
        const incomingEdges = new Map();
        const outgoingEdges = new Map();

        for (const edge of this.edges) {
            if (!incomingEdges.has(edge.to)) incomingEdges.set(edge.to, []);
            incomingEdges.get(edge.to).push(edge);

            if (!outgoingEdges.has(edge.from)) outgoingEdges.set(edge.from, []);
            outgoingEdges.get(edge.from).push(edge);
        }

        for (const [, encEdges] of incomingEdges.entries()) {
            if (encEdges.length <= 1) continue;
            encEdges.sort((a, b) => {
                const nodeA = this.nodes.find(n => n.id === a.from);
                const nodeB = this.nodes.find(n => n.id === b.from);
                const ax = a.isBackRef ? -Infinity : (nodeA ? nodeA.x + nodeA.width / 2 : 0);
                const bx = b.isBackRef ? -Infinity : (nodeB ? nodeB.x + nodeB.width / 2 : 0);
                return ax - bx;
            });
            const spread = 24;
            const startX = -((encEdges.length - 1) * spread) / 2;
            encEdges.forEach((e, idx) => { e.targetOffsetX = startX + idx * spread; });
        }

        for (const [, outEdges] of outgoingEdges.entries()) {
            if (outEdges.length <= 1) continue;
            outEdges.sort((a, b) => {
                const nodeA = this.nodes.find(n => n.id === a.to);
                const nodeB = this.nodes.find(n => n.id === b.to);
                const ax = a.isBackRef ? -Infinity : (nodeA ? nodeA.x + nodeA.width / 2 : 0);
                const bx = b.isBackRef ? -Infinity : (nodeB ? nodeB.x + nodeB.width / 2 : 0);
                return ax - bx;
            });
            const spread = 24;
            const startX = -((outEdges.length - 1) * spread) / 2;
            outEdges.forEach((e, idx) => { e.sourceOffsetX = startX + idx * spread; });
        }

        // Draw edges first (behind nodes)
        for (const edge of this.edges) {
            this._drawEdge(edge);
        }

        // Draw nodes
        for (const node of this.nodes) {
            this._drawNode(node);
        }

        ctx.restore();
    }

    /**
     * Draw background grid
     */
    _drawGrid(w, h) {
        const ctx = this.ctx;
        const gridSize = 30 * this.scale;

        if (gridSize < 8) return; // Too small to bother

        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.02)';
        ctx.lineWidth = 1;

        const startX = this.offsetX % gridSize;
        const startY = this.offsetY % gridSize;

        for (let x = startX; x < w; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }

        for (let y = startY; y < h; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Draw a single node
     */
    _drawNode(node) {
        const ctx = this.ctx;
        const colors = this.config.colors[node.type] || this.config.colors.process;

        ctx.save();

        switch (node.type) {
            case 'terminator':
            case 'terminator_start':
            case 'terminator_end':
                this._drawTerminator(node, colors);
                break;
            case 'process':
                this._drawProcess(node, colors);
                break;
            case 'decision':
                this._drawDecision(node, colors);
                break;
            case 'io':
                this._drawIO(node, colors);
                break;
            case 'connector':
                this._drawConnector(node, colors);
                break;
            case 'sub_block':
                this._drawSubBlock(node, colors);
                break;
            default:
                this._drawProcess(node, colors);
        }

        ctx.restore();
    }

    /**
     * Draw terminator (rounded rectangle / stadium shape)
     */
    _drawTerminator(node, colors) {
        const ctx = this.ctx;
        const { x, y, width, height, text } = node;
        const radius = height / 2;

        // Glow
        ctx.shadowColor = colors.glow;
        ctx.shadowBlur = 20;

        // Shape
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.arc(x + width - radius, y + height / 2, radius, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(x + radius, y + height);
        ctx.arc(x + radius, y + height / 2, radius, Math.PI / 2, -Math.PI / 2);
        ctx.closePath();

        ctx.fillStyle = colors.bg;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Text
        ctx.fillStyle = colors.text;
        ctx.font = this.config.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + width / 2, y + height / 2 + 1);
    }

    /**
     * Draw process (rounded rectangle)
     */
    _drawProcess(node, colors) {
        const ctx = this.ctx;
        const { x, y, width, height, text } = node;
        const r = 10;

        ctx.shadowColor = colors.glow;
        ctx.shadowBlur = 16;

        this._roundedRect(x, y, width, height, r);
        ctx.fillStyle = colors.bg;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = colors.text;
        ctx.font = this.config.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        this._wrapText(text, x + width / 2, y + height / 2, width - 20);
    }

    /**
     * Draw decision (diamond)
     */
    _drawDecision(node, colors) {
        const ctx = this.ctx;
        const { x, y, width, height, text } = node;
        const cx = x + width / 2;
        const cy = y + height / 2;

        ctx.shadowColor = colors.glow;
        ctx.shadowBlur = 16;

        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.lineTo(x + width, cy);
        ctx.lineTo(cx, y + height);
        ctx.lineTo(x, cy);
        ctx.closePath();

        ctx.fillStyle = colors.bg;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = colors.text;
        ctx.font = this.config.smallFont;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        this._wrapText(text, cx, cy, width * 0.55, 13);
    }

    /**
     * Draw I/O (parallelogram)
     */
    _drawIO(node, colors) {
        const ctx = this.ctx;
        const { x, y, width, height, text } = node;
        const skew = this.config.ioSkew;

        ctx.shadowColor = colors.glow;
        ctx.shadowBlur = 16;

        ctx.beginPath();
        ctx.moveTo(x + skew, y);
        ctx.lineTo(x + width, y);
        ctx.lineTo(x + width - skew, y + height);
        ctx.lineTo(x, y + height);
        ctx.closePath();

        ctx.fillStyle = colors.bg;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = colors.text;
        ctx.font = this.config.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + width / 2, y + height / 2 + 1);
    }

    /**
     * Draw connector (small circle)
     */
    _drawConnector(node, colors) {
        const ctx = this.ctx;
        const r = this.config.connectorRadius;
        const cx = node.x + r;
        const cy = node.y + r;

        ctx.shadowColor = colors.glow;
        ctx.shadowBlur = 12;

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = colors.bg;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    /**
     * Draw sub-block (box with positional labels)
     */
    _drawSubBlock(node, colors) {
        const ctx = this.ctx;
        const { x, y, width, height, subBlocks } = node;
        const r = 10;

        ctx.shadowColor = colors.glow;
        ctx.shadowBlur = 16;

        this._roundedRect(x, y, width, height, r);
        ctx.fillStyle = colors.bg;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 2;
        ctx.stroke();

        if (!subBlocks) return;

        ctx.font = this.config.smallFont;
        const pad = 12;

        if (subBlocks.tm) {
            ctx.fillStyle = colors.text;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(subBlocks.tm, x + width / 2, y + pad);
        }
        if (subBlocks.bm) {
            ctx.fillStyle = colors.text;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(subBlocks.bm, x + width / 2, y + height - pad);
        }
        if (subBlocks.tl) {
            ctx.fillStyle = colors.text;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(subBlocks.tl, x + pad, y + pad);
        }
        if (subBlocks.tr) {
            ctx.fillStyle = colors.text;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.fillText(subBlocks.tr, x + width - pad, y + pad);
        }
        if (subBlocks.bl) {
            ctx.fillStyle = colors.text;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText(subBlocks.bl, x + pad, y + height - pad);
        }
        if (subBlocks.br) {
            ctx.fillStyle = colors.text;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'bottom';
            ctx.fillText(subBlocks.br, x + width - pad, y + height - pad);
        }
    }

    /**
     * Draw an edge (arrow)
     */
    _drawEdge(edge) {
        const ctx = this.ctx;
        const fromNode = this.nodes.find(n => n.id === edge.from);
        const toNode = this.nodes.find(n => n.id === edge.to);

        if (!fromNode || !toNode) return;

        // Get anchor points
        const from = this._getNodeAnchor(fromNode, 'bottom');
        const to = this._getNodeAnchor(toNode, 'top');

        if (edge.sourceOffsetX) from.x += edge.sourceOffsetX;
        if (edge.targetOffsetX) to.x += edge.targetOffsetX;

        ctx.save();

        // Style
        let arrowColor = this.config.arrowColor;

        if (edge.isBackRef) {
            // Draw solid line, but match the destination node's theme color
            const targetColorCfg = this.config.colors[toNode.type] || this.config.colors.process;
            arrowColor = targetColorCfg.border;
            ctx.setLineDash([]); // solid line instead of dotted!
            ctx.strokeStyle = arrowColor;
        } else {
            ctx.strokeStyle = this.config.arrowColor;
        }
        ctx.lineWidth = this.config.arrowWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Draw smooth path
        const dx = to.x - from.x;
        const dy = to.y - from.y;

        ctx.beginPath();
        ctx.moveTo(from.x, from.y);

        if (edge.isBackRef) {
            // Back-reference: route around the left side, far enough not to overlap with sibling/parent nodes
            // Apply dynamic stagger based on edge index to prevent multiple backrefs from overlapping
            const edgeIndex = this.edges.indexOf(edge);
            const stagger = (edgeIndex % 6) * 15;
            let minX = Math.min(from.x, to.x) - 40 - stagger;
            const minY = Math.min(from.y, to.y);
            const maxY = Math.max(from.y, to.y);

            // Check nodes in this vertical span to ensure we route around the widest node
            for (const n of this.nodes) {
                if (n.y + n.height >= minY && n.y <= maxY) {
                    minX = Math.min(minX, n.x - 40 - stagger);
                }
            }

            ctx.lineTo(from.x, from.y + 20);
            ctx.lineTo(minX, from.y + 20);
            ctx.lineTo(minX, to.y - 12);
            ctx.lineTo(to.x, to.y - 12);
            ctx.lineTo(to.x, to.y);
        } else if (Math.abs(dx) < 5) {
            // Straight down
            ctx.lineTo(to.x, to.y);
        } else {
            // Curved path using smooth interpolation
            const isUpward = dy < 0;
            if (isUpward) {
                // If moving upward, route using Bezier differently to prevent clipping the shapes
                const cpY = from.y + 40;
                const cp2Y = to.y - 40;
                ctx.bezierCurveTo(from.x, cpY, to.x, cp2Y, to.x, to.y);
            } else {
                const curveOffset = Math.max(40, dy / 2);
                ctx.bezierCurveTo(from.x, from.y + curveOffset, to.x, to.y - curveOffset, to.x, to.y);
            }
        }

        ctx.stroke();
        ctx.setLineDash([]);

        // Arrowhead
        this._drawArrowhead(to.x, to.y, edge.isBackRef ? 'down' : (dy >= 0 ? 'down' : 'up'), arrowColor);

        // Label
        if (edge.label) {
            const labelX = (from.x + to.x) / 2;
            const labelY = (from.y + to.y) / 2;

            ctx.font = this.config.labelFont;
            const tw = ctx.measureText(edge.label).width;

            // Label background
            ctx.fillStyle = 'rgba(10,10,15,0.85)';
            this._roundedRect(labelX - tw / 2 - 8, labelY - 9, tw + 16, 20, 6);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = this.config.arrowLabelColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(edge.label, labelX, labelY + 1);
        }

        ctx.restore();
    }

    /**
     * Draw arrowhead
     */
    _drawArrowhead(x, y, direction, color) {
        const ctx = this.ctx;
        const size = this.config.arrowHeadSize;

        ctx.fillStyle = color;
        ctx.beginPath();

        if (direction === 'down') {
            ctx.moveTo(x, y);
            ctx.lineTo(x - size / 2, y - size);
            ctx.lineTo(x + size / 2, y - size);
        } else {
            ctx.moveTo(x, y);
            ctx.lineTo(x - size / 2, y + size);
            ctx.lineTo(x + size / 2, y + size);
        }

        ctx.closePath();
        ctx.fill();
    }

    /**
     * Get anchor point of a node
     */
    _getNodeAnchor(node, position) {
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

    /**
     * Helper: rounded rectangle path
     */
    _roundedRect(x, y, w, h, r) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }

    /**
     * Helper: wrap text within max width
     */
    _wrapText(text, x, y, maxWidth, lineHeight = 16) {
        const ctx = this.ctx;
        const words = text.split(' ');
        let line = '';
        const lines = [];

        for (const word of words) {
            const testLine = line ? line + ' ' + word : word;
            if (ctx.measureText(testLine).width > maxWidth && line) {
                lines.push(line);
                line = word;
            } else {
                line = testLine;
            }
        }
        lines.push(line);

        const totalH = lines.length * lineHeight;
        const startY = y - totalH / 2 + lineHeight / 2;

        for (let i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], x, startY + i * lineHeight);
        }
    }

    // ═══ Pan & Zoom Interaction ═══════════════════════════════════════════

    _setupInteraction() {
        const container = this.canvas.parentElement;

        // Mouse wheel → zoom
        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY > 0 ? 0.92 : 1.08;
            const rect = this.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            // Zoom towards cursor
            this.offsetX = mx - (mx - this.offsetX) * zoomFactor;
            this.offsetY = my - (my - this.offsetY) * zoomFactor;
            this.scale *= zoomFactor;
            this.scale = Math.max(0.1, Math.min(5, this.scale));

            this._draw();
            this._fireZoomChange();
        }, { passive: false });

        // Mouse drag → pan / Click → edit
        let didPan = false;
        container.addEventListener('mousedown', (e) => {
            didPan = false;
            this.isPanning = true;
            this.lastPanX = e.clientX;
            this.lastPanY = e.clientY;
            container.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isPanning) return;
            const dx = e.clientX - this.lastPanX;
            const dy = e.clientY - this.lastPanY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didPan = true;
            this.offsetX += dx;
            this.offsetY += dy;
            this.lastPanX = e.clientX;
            this.lastPanY = e.clientY;
            this._draw();
        });

        window.addEventListener('mouseup', (e) => {
            this.isPanning = false;
            container.style.cursor = 'grab';

            if (!didPan && e.target === this.canvas) {
                const rect = this.canvas.getBoundingClientRect();
                const mx = (e.clientX - rect.left - this.offsetX) / this.scale;
                const my = (e.clientY - rect.top - this.offsetY) / this.scale;

                for (let i = this.nodes.length - 1; i >= 0; i--) {
                    const n = this.nodes[i];
                    if (mx >= n.x && mx <= n.x + n.width && my >= n.y && my <= n.y + n.height) {
                        this._handleNodeClick(n);
                        break;
                    }
                }
            }
        });

        // Resize observer
        const resizeObs = new ResizeObserver(() => {
            this._resizeCanvas();
            this._draw();
        });
        resizeObs.observe(container);
    }

    _fireZoomChange() {
        const event = new CustomEvent('zoomchange', { detail: { scale: this.scale } });
        this.canvas.dispatchEvent(event);
    }

    _handleNodeClick(node) {
        if (node.type === 'connector') return; // cannot edit empty connector
        if (node.type === 'sub_block') return; // multi edit not natively supported in prompt

        const newText = prompt('Edit block text (updates code automatically):', node.text);
        if (newText !== null && newText.trim() !== '') {
            const oldText = node.text;
            node.text = newText.trim();
            const event = new CustomEvent('nodeedit', { detail: { node, oldText, newText: node.text } });
            this.canvas.dispatchEvent(event);

            this._layoutNodes();
            this._draw();
        }
    }

    /**
     * Export canvas as PNG data URL
     */
    exportPNG() {
        // Draw onto a temp canvas with white bg
        const tempCanvas = document.createElement('canvas');
        const bounds = this._getGraphBounds();
        const padding = 60;

        tempCanvas.width = (bounds.width + padding * 2) * 2;
        tempCanvas.height = (bounds.height + padding * 2) * 2;

        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.scale(2, 2);

        // Background
        tempCtx.fillStyle = '#0a0a0f';
        tempCtx.fillRect(0, 0, bounds.width + padding * 2, bounds.height + padding * 2);

        // Translate to fit
        tempCtx.translate(padding - bounds.minX, padding - bounds.minY);

        // Swap context temporarily
        const origCtx = this.ctx;
        this.ctx = tempCtx;

        // Draw
        for (const edge of this.edges) this._drawEdge(edge);
        for (const node of this.nodes) this._drawNode(node);

        this.ctx = origCtx;

        return tempCanvas.toDataURL('image/png');
    }

    /**
     * Export canvas as SVG (simple conversion)
     */
    exportSVG() {
        // For simplicity, export as PNG embedded in SVG
        const dataUrl = this.exportPNG();
        const bounds = this._getGraphBounds();
        const w = bounds.width + 120;
        const h = bounds.height + 120;
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
            <image href="${dataUrl}" width="${w}" height="${h}"/>
        </svg>`;
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

    /**
     * Zoom controls
     */
    zoomIn() {
        this.scale *= 1.2;
        this.scale = Math.min(5, this.scale);
        this._draw();
        this._fireZoomChange();
    }

    zoomOut() {
        this.scale *= 0.83;
        this.scale = Math.max(0.1, this.scale);
        this._draw();
        this._fireZoomChange();
    }

    fitToScreen() {
        this._centerGraph();
        this._draw();
        this._fireZoomChange();
    }
}

window.FlowchartRenderer = FlowchartRenderer;
