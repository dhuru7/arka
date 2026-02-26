/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Bridge Language Parser
 *  Parses the custom flowchart DSL into a structured graph
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

        // Split into Phase 1 and Phase 2
        const parts = code.split(/^\.\.\.\.\.\s*$/m);
        const phase1 = parts[0] ? parts[0].trim() : '';
        const phase2 = parts[1] ? parts[1].trim() : '';

        if (phase1) this._parsePhase1(phase1);
        if (phase2) this._parsePhase2(phase2);

        return { nodes: this.nodes, edges: this.edges };
    }

    _normalizeRaw(str) {
        return str.replace(/\s+/g, '');
    }

    _parsePhase1(code) {
        const lines = code.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        let i = 0;

        while (i < lines.length) {
            let line = lines[i];

            if (line.startsWith('B{')) {
                let content = line;
                let depth = 0;
                for (const ch of line) { if (ch === '{') depth++; if (ch === '}') depth--; }

                while (depth > 0 && i + 1 < lines.length) {
                    i++;
                    const nextLine = lines[i];
                    content += ' ' + nextLine;
                    for (const ch of nextLine) { if (ch === '{') depth++; if (ch === '}') depth--; }
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
        // Terminator Start/End
        if (content.match(/^ts\(\)$/)) return { type: 'terminator_start', text: 'Start' };
        if (content.match(/^te\(\)$/)) return { type: 'terminator_end', text: 'End' };

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
        if (content.match(/^c\[\)$/)) return { type: 'connector', text: '' };

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

    _parsePhase2(code) {
        const lines = code.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        let i = 0;
        let prevNode = null;
        let pendingArrowLabel = null;
        let pendingArrowDir = null;

        while (i < lines.length) {
            let line = lines[i];

            // 1. Is it a lonely backref? `a>!target`
            const backRefMatchSolo = line.match(/^a(?:\*(.*?)\*?)?([><])?!(.+)$/);
            if (backRefMatchSolo) {
                const label = backRefMatchSolo[1] || null;
                const dir = backRefMatchSolo[2] === '<' ? 'backward' : 'forward';
                const targetCode = backRefMatchSolo[3];
                const targetNode = this._findNodeByRaw(targetCode);

                if (targetNode && prevNode) {
                    if (dir === 'backward') this._addEdge(targetNode.id, prevNode.id, label, true);
                    else this._addEdge(prevNode.id, targetNode.id, label, true);
                }
                prevNode = null;
                i++;
                continue;
            }

            // 2. Is it `ma>[` ? (Branching Out)
            const maMatch = line.match(/^ma(?:\*(.*?)\*?)?([><])\[$/);
            if (maMatch) {
                const groupLabel = maMatch[1] || null;
                const groupDir = maMatch[2] === '<' ? 'backward' : 'forward';

                let innerContent = '';
                i++;
                while (i < lines.length && lines[i] !== ']') {
                    innerContent += lines[i] + '\n';
                    i++;
                }

                const innerLines = innerContent.split('\n').map(l => l.trim()).filter(l => l);
                let currentBranchArrowLabel = null;
                const pNode = prevNode;

                for (const il of innerLines) {
                    const arrMatch = il.match(/^a(?:\*(.*?)\*?)?([><])?$/);
                    if (arrMatch && (arrMatch[1] || arrMatch[2])) {
                        currentBranchArrowLabel = arrMatch[1] || null;
                    } else {
                        const nNode = this._findNodeByRaw(il);
                        if (nNode && pNode) {
                            if (groupDir === 'forward') {
                                this._addEdge(pNode.id, nNode.id, currentBranchArrowLabel || groupLabel);
                            } else {
                                this._addEdge(nNode.id, pNode.id, currentBranchArrowLabel || groupLabel);
                            }
                        }
                        currentBranchArrowLabel = null;
                    }
                }
                i++;
                continue;
            }

            // 3. Merging in? `targetCode ma*...*[<..`
            const matchMerge = line.match(/^(.*?)ma(?:\*(.*?)\*?)?([><])\[$/);
            if (matchMerge && matchMerge[1]) {
                const n = this._findNodeByRaw(matchMerge[1].trim());
                if (n) prevNode = n;

                const groupLabel = matchMerge[2] || null;
                const groupDir = matchMerge[3] === '<' ? 'backward' : 'forward'; // usually < for merge

                let innerContent = '';
                i++;
                while (i < lines.length && lines[i] !== ']') {
                    innerContent += lines[i] + '\n';
                    i++;
                }
                const innerLines = innerContent.split('\n').map(l => l.trim()).filter(l => l);
                let currentBranchArrowLabel = null;

                for (const il of innerLines) {
                    const arrMatch = il.match(/^a(?:\*(.*?)\*?)?([><])?$/);
                    if (arrMatch && (arrMatch[1] || arrMatch[2])) {
                        currentBranchArrowLabel = arrMatch[1] || null;
                    } else {
                        // find the source node
                        const srNode = this._findNodeByRaw(il);
                        if (srNode && prevNode) {
                            if (groupDir === 'backward') {
                                // "backward" in merge `ma<[` usually means arrows go FROM inside nodes TO prevNode
                                this._addEdge(srNode.id, prevNode.id, currentBranchArrowLabel || groupLabel);
                            } else {
                                this._addEdge(prevNode.id, srNode.id, currentBranchArrowLabel || groupLabel);
                            }
                        }
                        currentBranchArrowLabel = null;
                    }
                }
                i++;
                continue;
            }

            // 4. normal arrow? `a>` or `a*label>` or `a*label*`
            const arrMatch = line.match(/^a(?:\*(.*?)\*?)?([><])?$/);
            if (arrMatch && (arrMatch[1] || arrMatch[2])) {
                pendingArrowLabel = arrMatch[1] || null;
                pendingArrowDir = arrMatch[2] === '<' ? 'backward' : 'forward';
                i++;
                continue;
            }
            if (line === 'a>') {
                pendingArrowLabel = null;
                pendingArrowDir = 'forward';
                i++;
                continue;
            }
            if (line === 'a<') {
                pendingArrowLabel = null;
                pendingArrowDir = 'backward';
                i++;
                continue;
            }

            // 5. Normal node line, or node line with loop `p[...]a>!ts()`
            let matchedNodeLine = false;
            const lineNorm = this._normalizeRaw(line);

            // Find longest prefix match among phase 1 nodes just in case
            let matchedNode = null;
            for (const node of this.nodes) {
                const nodeRawNorm = this._normalizeRaw(node.raw);
                if (lineNorm.startsWith(nodeRawNorm)) {
                    if (!matchedNode || nodeRawNorm.length > this._normalizeRaw(matchedNode.raw).length) {
                        matchedNode = node;
                    }
                }
            }

            if (matchedNode) {
                if (prevNode && pendingArrowDir) {
                    if (pendingArrowDir === 'forward') {
                        this._addEdge(prevNode.id, matchedNode.id, pendingArrowLabel);
                    } else {
                        this._addEdge(matchedNode.id, prevNode.id, pendingArrowLabel);
                    }
                }

                prevNode = matchedNode;
                pendingArrowLabel = null;
                pendingArrowDir = null;
                matchedNodeLine = true;

                // Check remainder
                const nodeRawNormLength = this._normalizeRaw(matchedNode.raw).length;
                const remainder = lineNorm.substring(nodeRawNormLength);
                if (remainder) {
                    const remMatch = remainder.match(/^a(?:\*(.*?)\*?)?([><])?!(.+)$/);
                    if (remMatch) {
                        const lbl = remMatch[1] || null;
                        const dir = remMatch[2] === '<' ? 'backward' : 'forward';
                        const tgtCode = remMatch[3];
                        const tgtNode = this.nodes.find(n => this._normalizeRaw(n.raw) === tgtCode);
                        if (tgtNode) {
                            if (dir === 'forward') this._addEdge(prevNode.id, tgtNode.id, lbl, true);
                            else this._addEdge(tgtNode.id, prevNode.id, lbl, true);
                        }
                        prevNode = null;
                    }
                }
            }

            i++;
        }
    }

    _findNodeByRaw(raw) {
        const norm = this._normalizeRaw(raw);
        return this.nodes.find(n => this._normalizeRaw(n.raw) === norm) || null;
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
        // avoid duplicates?
        let existing = this._findNodeByRaw(raw);
        if (existing) return existing.id; // Phase 1 duplicate safety

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
        this.edges.push({ from: fromId, to: toId, label, isBackRef });
    }
}

// Export for use
window.BridgeParser = BridgeParser;
