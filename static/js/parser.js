/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Bridge Language Parser v2.4
 *  Robust parser for the custom flowchart DSL
 *  Handles restated decision branching, back-references, and multi-connections
 * ═══════════════════════════════════════════════════════════════════════════
 */

class BridgeParser {
    constructor() {
        this.nodes = [];
        this.edges = [];
        this.nodeIdCounter = 0;
    }

    parse(code) {
        this.nodes = [];
        this.edges = [];
        this.nodeIdCounter = 0;

        // Normalize line endings
        code = code.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // Split into Phase 1 (Declaration) and Phase 2 (Structure)
        const parts = code.split(/^\.\.\.\.\.[ \t]*$/m);
        const phase1 = parts[0] ? parts[0].trim() : '';
        const phase2 = parts[1] ? parts[1].trim() : '';

        if (phase1) this._parsePhase1(phase1);
        if (phase2) this._parsePhase2(phase2);

        return { nodes: this.nodes, edges: this.edges };
    }

    // ═══ Phase 1: Declaration ═══════════════════════════════════════════════

    _parsePhase1(code) {
        const lines = code.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        let i = 0;

        while (i < lines.length) {
            let line = lines[i];

            // Multi-line B{...} block
            if (line.startsWith('B{')) {
                let content = line;
                let depth = 0;
                for (const ch of line) { if (ch === '{') depth++; if (ch === '}') depth--; }

                while (depth > 0 && i + 1 < lines.length) {
                    i++;
                    content += ' ' + lines[i];
                    for (const ch of lines[i]) { if (ch === '{') depth++; if (ch === '}') depth--; }
                }
                const block = this._parseBlock(content);
                if (block) this._addNode(block, content);
            } else {
                const block = this._parseBlock(line);
                if (block) this._addNode(block, line);
            }
            i++;
        }
    }

    _parseBlock(content) {
        content = content.trim();

        // Terminator Start/End
        if (/^ts\(\)$/.test(content)) return { type: 'terminator_start', text: 'Start' };
        if (/^te\(\)$/.test(content)) return { type: 'terminator_end', text: 'End' };

        // General oval: t("...")
        let match = content.match(/^t\((.+)\)$/);
        if (match) return { type: 'terminator', text: this._extractText(match[1]) };

        // Process: p["..."]
        match = content.match(/^p\[(.+)\]$/);
        if (match) return { type: 'process', text: this._extractText(match[1]) };

        // Input/Output: l["..."]
        match = content.match(/^l\[(.+)\]$/);
        if (match) return { type: 'io', text: this._extractText(match[1]) };

        // Decision: d<"...">
        match = content.match(/^d<(.+)>$/);
        if (match) return { type: 'decision', text: this._extractText(match[1]) };

        // Connector: c[)
        if (/^c\[\)$/.test(content)) return { type: 'connector', text: '' };

        // B{...}
        match = content.match(/^B\{(.+)\}$/);
        if (match) {
            const subBlocks = this._parseSubBlocks(match[1]);
            return { type: 'sub_block', text: subBlocks.tm || subBlocks.tl || 'Block', subBlocks };
        }

        return null;
    }

    _parseSubBlocks(content) {
        const result = {};
        const tags = ['tm', 'bm', 'tl', 'tr', 'bl', 'br'];
        for (const tag of tags) {
            const regex = new RegExp(`\\*${tag}:\\s*(.+?)(?=\\*[a-z]{2}:|$)`);
            const match = content.match(regex);
            if (match) {
                result[tag] = this._extractText(match[1].trim());
            }
        }
        return result;
    }

    // ═══ Phase 2: Structure/Connection ═══════════════════════════════════════

    _parsePhase2(code) {
        const lines = code.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        let i = 0;
        let prevNode = null;
        let pendingArrowLabel = null;
        let pendingArrowDir = null;

        while (i < lines.length) {
            let line = lines[i];

            // ── 1. Check for inline back-reference: nodeCode a>!targetCode ───
            const inlineBackRef = this._matchInlineBackRef(line);
            if (inlineBackRef) {
                const { sourceCode, label, direction, targetCode } = inlineBackRef;
                const srcNode = this._findNodeByCode(sourceCode);
                const tgtNode = this._findNodeByCode(targetCode);

                if (srcNode && tgtNode) {
                    // Connect prevNode -> srcNode if there's a pending arrow
                    if (prevNode && pendingArrowDir && srcNode.id !== prevNode.id) {
                        this._connectNodes(prevNode, srcNode, pendingArrowLabel, pendingArrowDir);
                        pendingArrowLabel = null;
                        pendingArrowDir = null;
                    }
                    // Add the back-reference edge
                    if (direction === 'forward') {
                        this._addEdge(srcNode.id, tgtNode.id, label, true);
                    } else {
                        this._addEdge(tgtNode.id, srcNode.id, label, true);
                    }
                    prevNode = null;
                }
                i++;
                continue;
            }

            // ── 2. Standalone back-reference: a>!targetCode ─────────────────
            const soloBackRef = line.match(/^a(?:\*(.*?)\*?)?([\>\<])?!(.+)$/);
            if (soloBackRef) {
                const label = soloBackRef[1] || null;
                const dir = soloBackRef[2] === '<' ? 'backward' : 'forward';
                const targetCode = soloBackRef[3];
                const targetNode = this._findNodeByCode(targetCode);

                if (targetNode && prevNode) {
                    if (dir === 'forward') this._addEdge(prevNode.id, targetNode.id, label, true);
                    else this._addEdge(targetNode.id, prevNode.id, label, true);
                }
                prevNode = null;
                i++;
                continue;
            }

            // ── 3. Multi-connection branching out: ma*label>[  ───────────────
            const maOutMatch = line.match(/^ma(?:\*(.*?)\*?)?([\>\<])\[$/);
            if (maOutMatch) {
                const groupLabel = maOutMatch[1] || null;
                const groupDir = maOutMatch[2] === '<' ? 'backward' : 'forward';
                const srcNode = prevNode;

                let innerLines = [];
                i++;
                while (i < lines.length && lines[i] !== ']') {
                    innerLines.push(lines[i]);
                    i++;
                }
                this._processMultiConnect(srcNode, innerLines, groupLabel, groupDir, 'outgoing');
                i++; // skip ']'
                continue;
            }

            // ── 4. Multi-connection merging in: targetCode ma*label<[  ───────
            const maMergeMatch = line.match(/^(.+?)ma(?:\*(.*?)\*?)?([\>\<])\[$/);
            if (maMergeMatch && maMergeMatch[1]) {
                const targetNode = this._findNodeByCode(maMergeMatch[1].trim());
                const groupLabel = maMergeMatch[2] || null;
                const groupDir = maMergeMatch[3] === '<' ? 'backward' : 'forward';

                if (targetNode) prevNode = targetNode;

                let innerLines = [];
                i++;
                while (i < lines.length && lines[i] !== ']') {
                    innerLines.push(lines[i]);
                    i++;
                }
                this._processMultiConnect(prevNode, innerLines, groupLabel, groupDir, 'incoming');
                i++; // skip ']'
                continue;
            }

            // ── 5. Arrow line: a>, a<, a*label*>, a*label> ───────────────────
            const arrowMatch = this._matchArrowLine(line);
            if (arrowMatch) {
                pendingArrowLabel = arrowMatch.label;
                pendingArrowDir = arrowMatch.direction;
                i++;
                continue;
            }

            // ── 6. Node line (possibly restated for branching) ───────────────
            const matchedNode = this._findNodeByCode(line);
            if (matchedNode) {
                if (prevNode && pendingArrowDir) {
                    this._connectNodes(prevNode, matchedNode, pendingArrowLabel, pendingArrowDir);
                }
                prevNode = matchedNode;
                pendingArrowLabel = null;
                pendingArrowDir = null;
            }

            i++;
        }
    }

    _matchInlineBackRef(line) {
        // Pattern: nodeCode a*label*>!targetCode  or  nodeCode a>!targetCode
        // We need to find the split point where the node code ends and the arrow begins

        // Try each known node as a prefix
        let bestMatch = null;
        for (const node of this.nodes) {
            if (line.startsWith(node.raw)) {
                const remainder = line.substring(node.raw.length);
                const refMatch = remainder.match(/^a(?:\*(.*?)\*?)?([\>\<])?!(.+)$/);
                if (refMatch) {
                    if (!bestMatch || node.raw.length > bestMatch.sourceCode.length) {
                        bestMatch = {
                            sourceCode: node.raw,
                            label: refMatch[1] || null,
                            direction: refMatch[2] === '<' ? 'backward' : 'forward',
                            targetCode: refMatch[3]
                        };
                    }
                }
            }
        }
        return bestMatch;
    }

    _matchArrowLine(line) {
        // Exact match for simple arrows
        if (line === 'a>') return { label: null, direction: 'forward' };
        if (line === 'a<') return { label: null, direction: 'backward' };

        // Labeled arrow: a*label*> or a*label> or a*label*< etc.
        const match = line.match(/^a\*(.*?)\*?([\>\<])$/);
        if (match) {
            return { label: match[1] || null, direction: match[2] === '<' ? 'backward' : 'forward' };
        }
        return null;
    }

    _processMultiConnect(anchorNode, innerLines, groupLabel, groupDir, mode) {
        let currentLabel = null;
        let isFirstTarget = true;

        for (const il of innerLines) {
            const trimmed = il.trim();
            if (!trimmed) continue;

            // Check if it's an arrow line (a>, a<, a*label*>, a*label*<)
            const arrowMatch = this._matchArrowLine(trimmed);
            if (arrowMatch) {
                currentLabel = arrowMatch.label;
                continue;
            }

            // Check for inline label: a*text*
            const labelOnly = trimmed.match(/^a\*(.*?)\*$/);
            if (labelOnly) {
                currentLabel = labelOnly[1] || null;
                continue;
            }

            // It's a node reference
            const node = this._findNodeByCode(trimmed);
            if (node && anchorNode) {
                // Label priority: explicit currentLabel > groupLabel (only for first target) > null
                let label;
                if (currentLabel !== null) {
                    label = currentLabel;
                } else if (isFirstTarget) {
                    label = groupLabel;
                } else {
                    label = null;
                }

                if (mode === 'outgoing') {
                    if (groupDir === 'forward') {
                        this._addEdge(anchorNode.id, node.id, label);
                    } else {
                        this._addEdge(node.id, anchorNode.id, label);
                    }
                } else {
                    // incoming/merging
                    if (groupDir === 'backward') {
                        this._addEdge(node.id, anchorNode.id, label);
                    } else {
                        this._addEdge(anchorNode.id, node.id, label);
                    }
                }
            }
            currentLabel = null;
            isFirstTarget = false;
        }
    }

    _connectNodes(fromNode, toNode, label, direction) {
        if (direction === 'forward') {
            this._addEdge(fromNode.id, toNode.id, label);
        } else {
            this._addEdge(toNode.id, fromNode.id, label);
        }
    }

    // ═══ Helpers ═════════════════════════════════════════════════════════════

    _findNodeByCode(code) {
        code = code.trim();
        // Exact match first
        let node = this.nodes.find(n => n.raw === code);
        if (node) return node;

        // Normalized match (strip whitespace)
        const norm = code.replace(/\s+/g, '');
        node = this.nodes.find(n => n.raw.replace(/\s+/g, '') === norm);
        return node || null;
    }

    _extractText(raw) {
        let text = raw.trim();
        let match = text.match(/^"""(.+?)"""$/s);
        if (match) return match[1].trim();
        match = text.match(/^'''(.+?)'''$/s);
        if (match) return match[1].trim();
        match = text.match(/^"(.+?)"$/s);
        if (match) return match[1].trim();
        match = text.match(/^'(.+?)'$/s);
        if (match) return match[1].trim();
        return text;
    }

    _addNode(block, raw) {
        // Avoid duplicates
        let existing = this._findNodeByCode(raw);
        if (existing) return existing.id;

        const id = this.nodeIdCounter++;
        this.nodes.push({
            id,
            type: block.type || 'process',
            text: block.text || '',
            subBlocks: block.subBlocks || null,
            raw: raw.trim(),
            x: 0,
            y: 0,
            width: 0,
            height: 0
        });
        return id;
    }

    _addEdge(fromId, toId, label = null, isBackRef = false) {
        // Avoid duplicate edges
        const exists = this.edges.some(e =>
            e.from === fromId && e.to === toId && e.label === label
        );
        if (!exists) {
            this.edges.push({ from: fromId, to: toId, label, isBackRef });
        }
    }
}

// Export for use
window.BridgeParser = BridgeParser;
