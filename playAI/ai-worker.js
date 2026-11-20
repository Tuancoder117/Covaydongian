/**
 * ai-worker.js - MCTS nâng cấp với Progressive Bias & Tactical Playout
 */

class MCTSNode {
    constructor(board, playerToMove, koPoint, move = null, parent = null, priorScore = 0) {
        this.board = board;
        this.playerToMove = playerToMove;
        this.koPoint = koPoint;
        this.move = move;
        this.parent = parent;
        this.priorScore = priorScore;
        this.children = [];
        this.visits = 0;
        this.wins = 0;
        this.untriedMoves = null;
    }

    isFullyExpanded() {
        return this.untriedMoves !== null && this.untriedMoves.length === 0;
    }

    bestScore(explorationC = 1.35, biasWeight = 0.5) {
        let bestChild = null;
        let bestVal = -Infinity;

        for (const child of this.children) {
            if (child.visits === 0) return child;
            const exploitation = child.wins / child.visits;
            const exploration = explorationC * Math.sqrt(Math.log(Math.max(1, this.visits)) / child.visits);
            const progressiveBias = (child.priorScore * biasWeight) / (1 + child.visits);
            const total = exploitation + exploration + progressiveBias;

            if (total > bestVal) {
                bestVal = total;
                bestChild = child;
            }
        }
        return bestChild;
    }
}

class StrongBrowserGoAI {
    constructor(size, aiColor = 2) {
        this.size = size;
        this.aiColor = aiColor;
        this.opponentColor = aiColor === 1 ? 2 : 1;
    }

    search(board, koPoint, maxIterations = 1200, moveCount = 0) {
        const root = new MCTSNode(
            this.cloneBoard(board),
            this.aiColor,
            koPoint ? { ...koPoint } : null,
            null,
            null,
            0
        );
        root.untriedMoves = this.getRankedCandidateMoves(root.board, root.playerToMove, root.koPoint, moveCount);

        if (root.untriedMoves.length === 0) return null;
        if (root.untriedMoves.length === 1) return root.untriedMoves[0].move;

        const maxPlayoutSteps = Math.min(this.size * this.size, 180);
        let iterationsRun = 0;

        while (iterationsRun < maxIterations) {
            iterationsRun++;
            let node = root;

            // 1. Selection
            while (node.isFullyExpanded() && node.children.length > 0) {
                node = node.bestScore();
            }

            // 2. Expansion
            if (!node.isFullyExpanded()) {
                // Ưu tiên mở rộng các ứng viên có điểm prior cao hơn
                const candidate = node.untriedMoves.shift();
                const mv = candidate.move;
                const sim = this.applyMove(node.board, mv.x, mv.y, node.playerToMove, node.koPoint);

                if (sim.valid) {
                    const nextPlayer = node.playerToMove === 1 ? 2 : 1;
                    const child = new MCTSNode(
                        sim.board,
                        nextPlayer,
                        sim.nextKo,
                        mv,
                        node,
                        candidate.normPrior
                    );
                    child.untriedMoves = this.getRankedCandidateMoves(
                        child.board,
                        nextPlayer,
                        child.koPoint,
                        moveCount + 4
                    );
                    node.children.push(child);
                    node = child;
                }
            }

            // 3. Tactical Simulation
            const winner = this.simulateTacticalPlayout(
                node.board,
                node.playerToMove,
                node.koPoint,
                maxPlayoutSteps
            );

            // 4. Backpropagation
            const baseReward = winner === this.aiColor ? 1 : (winner === 0 ? 0.5 : 0);
            let curr = node;
            while (curr !== null) {
                curr.visits++;
                if (curr.parent === null) {
                    curr.wins += baseReward;
                } else {
                    const mover = curr.parent.playerToMove;
                    curr.wins += (mover === this.aiColor ? baseReward : 1 - baseReward);
                }
                curr = curr.parent;
            }
        }

        let bestChild = null;
        let bestVisits = -1;
        for (const child of root.children) {
            if (child.visits > bestVisits) {
                bestVisits = child.visits;
                bestChild = child;
            }
        }

        return bestChild ? bestChild.move : root.untriedMoves[0]?.move || null;
    }

    getStarPoints() {
        return this.size === 9
            ? [[2, 2], [6, 2], [2, 6], [6, 6], [4, 4]]
            : this.size === 13
                ? [[3, 3], [9, 3], [3, 9], [9, 9], [6, 6]]
                : [[3, 3], [9, 3], [15, 3], [3, 9], [15, 9], [3, 15], [9, 15], [15, 15]];
    }

    getRankedCandidateMoves(board, player, koPoint, moveCount) {
        const rawMoves = [];
        const hasAnyStone = this.hasStones(board);
        const searchRadius = this.size >= 19 ? 2 : 3;
        const strategicPoints = new Set(this.getStarPoints().map(([x, y]) => `${x},${y}`));

        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (board[y][x] !== 0) continue;
                if (koPoint && koPoint.x === x && koPoint.y === y) continue;
                if (
                    hasAnyStone &&
                    moveCount > 2 &&
                    !this.isNearStone(board, x, y, searchRadius) &&
                    !strategicPoints.has(`${x},${y}`)
                ) {
                    continue;
                }
                if (this.isTrueEyeLike(board, x, y, player)) continue;

                const sim = this.applyMove(board, x, y, player, koPoint);
                if (!sim.valid) continue;

                const heuristic = this.scoreTacticalMove(board, sim, x, y, player);
                rawMoves.push({ move: { x, y }, heuristic });
            }
        }

        if (rawMoves.length === 0) {
            for (let y = 0; y < this.size; y++) {
                for (let x = 0; x < this.size; x++) {
                    if (board[y][x] === 0 && !(koPoint && koPoint.x === x && koPoint.y === y)) {
                        if (this.applyMove(board, x, y, player, koPoint).valid) {
                            rawMoves.push({ move: { x, y }, heuristic: 0 });
                        }
                    }
                }
            }
        }

        rawMoves.sort((a, b) => b.heuristic - a.heuristic);
        // Giới hạn số nhánh mở rộng để tập trung lực tính toán
        const cap = this.size >= 50 ? 100 : 40;
        const trimmed = rawMoves.slice(0, cap);

        const maxH = trimmed.length > 0 ? Math.max(1, Math.abs(trimmed[0].heuristic)) : 1;
        return trimmed.map(item => ({
            move: item.move,
            normPrior: Math.max(0, Math.min(1, (item.heuristic + maxH) / (2 * maxH)))
        }));
    }

    scoreTacticalMove(oldBoard, sim, x, y, player) {
        const opp = player === 1 ? 2 : 1;
        let score = 0;

        // Ăn quân đối thủ
        score += sim.capturedCount * 140;

        // Đánh vào khí đối thủ (Atari) và cứu quân mình đang bị Atari
        const neighbors = this.getNeighbors(x, y);
        const myNewGroup = this.getGroupAndLiberties(sim.board, x, y);

        if (myNewGroup.liberties === 1) {
            score -= 80;
        } else {
            score += Math.min(40, myNewGroup.liberties * 8);
        }

        const alliedAtariGroups = new Set();
        for (const [nx, ny] of neighbors) {
            const oldVal = oldBoard[ny][nx];
            if (oldVal === player) {
                const oldG = this.getGroupAndLiberties(oldBoard, nx, ny);
                const key = `${oldG.stones[0][0]},${oldG.stones[0][1]}`;
                if (oldG.liberties === 1 && myNewGroup.liberties > 1 && !alliedAtariGroups.has(key)) {
                    alliedAtariGroups.add(key);
                    score += 110 * oldG.stones.length;
                }
            } else if (sim.board[ny][nx] === opp) {
                const oppG = this.getGroupAndLiberties(sim.board, nx, ny);
                if (oppG.liberties === 1) {
                    score += 45 * oppG.stones.length;
                }
            }
        }

        // Vị trí đường 3-4
        const dx = Math.min(x, this.size - 1 - x);
        const dy = Math.min(y, this.size - 1 - y);
        if (dx === 0 || dy === 0) score -= 12;
        else if ((dx === 2 || dx === 3) && (dy === 2 || dy === 3)) score += 20;
        else if (dx === 2 || dx === 3 || dy === 2 || dy === 3) score += 10;

        return score;
    }

    simulateTacticalPlayout(startBoard, startPlayer, startKo, maxSteps) {
        let board = this.cloneBoard(startBoard);
        let player = startPlayer;
        let ko = startKo ? { ...startKo } : null;
        let passes = 0;

        for (let step = 0; step < maxSteps; step++) {
            const move = this.pickSmartPlayoutMove(board, player, ko);
            if (!move) {
                passes++;
                if (passes >= 2) break;
                ko = null;
                player = player === 1 ? 2 : 1;
                continue;
            }

            const res = this.applyMove(board, move.x, move.y, player, ko);
            if (!res.valid) {
                passes++;
                if (passes >= 2) break;
                player = player === 1 ? 2 : 1;
                continue;
            }

            board = res.board;
            ko = res.nextKo;
            passes = 0;
            player = player === 1 ? 2 : 1;
        }

        return this.estimateWinner(board);
    }

    pickSmartPlayoutMove(board, player, ko) {
        const opp = player === 1 ? 2 : 1;
        const urgentMoves = [];
        const fallbackMoves = [];

        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (board[y][x] !== 0) continue;
                if (ko && ko.x === x && ko.y === y) continue;
                if (this.isTrueEyeLike(board, x, y, player)) continue;

                // Kiểm tra nhanh xem có ô kề bên đang còn 1 khí (của địch để ăn, hoặc của mình để cứu)
                for (const [nx, ny] of this.getNeighbors(x, y)) {
                    const val = board[ny][nx];
                    if (val === opp || val === player) {
                        const g = this.getGroupAndLiberties(board, nx, ny);
                        if (g.liberties === 1) {
                            urgentMoves.push({ x, y });
                            break;
                        }
                    }
                }
                fallbackMoves.push({ x, y });
            }
        }

        for (const list of [urgentMoves, fallbackMoves]) {
            if (list.length === 0) continue;
            const sample = Math.min(12, list.length);
            for (let i = 0; i < sample; i++) {
                const idx = i + Math.floor(Math.random() * (list.length - i));
                [list[i], list[idx]] = [list[idx], list[i]];
                const mv = list[i];
                if (this.applyMove(board, mv.x, mv.y, player, ko).valid) {
                    return mv;
                }
            }
        }
        return null;
    }

    estimateWinner(board) {
        const visited = Array.from({ length: this.size }, () => Array(this.size).fill(false));
        let blackScore = 0;
        let whiteScore = 6.5;

        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                const val = board[y][x];
                if (val === 1) blackScore++;
                else if (val === 2) whiteScore++;
                else if (!visited[y][x]) {
                    const region = [];
                    const borders = new Set();
                    const queue = [[x, y]];
                    visited[y][x] = true;

                    while (queue.length > 0) {
                        const [cx, cy] = queue.shift();
                        region.push([cx, cy]);
                        for (const [nx, ny] of this.getNeighbors(cx, cy)) {
                            if (board[ny][nx] === 0 && !visited[ny][nx]) {
                                visited[ny][nx] = true;
                                queue.push([nx, ny]);
                            } else if (board[ny][nx] !== 0) {
                                borders.add(board[ny][nx]);
                            }
                        }
                    }
                    if (borders.size === 1) {
                        const owner = [...borders][0];
                        if (owner === 1) blackScore += region.length;
                        if (owner === 2) whiteScore += region.length;
                    }
                }
            }
        }

        if (blackScore > whiteScore) return 1;
        if (whiteScore > blackScore) return 2;
        return 0;
    }

    applyMove(board, x, y, player, koPoint) {
        if (x < 0 || x >= this.size || y < 0 || y >= this.size) return { valid: false };
        if (board[y][x] !== 0) return { valid: false };
        if (koPoint && koPoint.x === x && koPoint.y === y) return { valid: false };

        const opp = player === 1 ? 2 : 1;
        const nextBoard = this.cloneBoard(board);
        nextBoard[y][x] = player;

        let captured = [];
        for (const [nx, ny] of this.getNeighbors(x, y)) {
            if (nextBoard[ny][nx] === opp) {
                const group = this.getGroupAndLiberties(nextBoard, nx, ny);
                if (group.liberties === 0) captured.push(...group.stones);
            }
        }

        for (const [sx, sy] of captured) nextBoard[sy][sx] = 0;

        const myGroup = this.getGroupAndLiberties(nextBoard, x, y);
        if (myGroup.liberties === 0) return { valid: false };

        let nextKo = null;
        if (captured.length === 1 && myGroup.stones.length === 1 && myGroup.liberties === 1) {
            nextKo = { x: captured[0][0], y: captured[0][1] };
        }

        return { valid: true, board: nextBoard, nextKo, capturedCount: captured.length };
    }

    getGroupAndLiberties(board, startX, startY) {
        const color = board[startY][startX];
        const visited = new Set([`${startX},${startY}`]);
        const liberties = new Set();
        const stones = [];
        const queue = [[startX, startY]];

        while (queue.length > 0) {
            const [cx, cy] = queue.shift();
            stones.push([cx, cy]);
            for (const [nx, ny] of this.getNeighbors(cx, cy)) {
                const key = `${nx},${ny}`;
                if (board[ny][nx] === 0) liberties.add(key);
                else if (board[ny][nx] === color && !visited.has(key)) {
                    visited.add(key);
                    queue.push([nx, ny]);
                }
            }
        }
        return { stones, liberties: liberties.size };
    }

    getNeighbors(x, y) {
        const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
        const res = [];
        for (const [dx, dy] of dirs) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < this.size && ny >= 0 && ny < this.size) res.push([nx, ny]);
        }
        return res;
    }

    isTrueEyeLike(board, x, y, color) {
        const neighbors = this.getNeighbors(x, y);
        return neighbors.length > 0 && neighbors.every(([nx, ny]) => board[ny][nx] === color);
    }

    isNearStone(board, x, y, radius) {
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && nx < this.size && ny >= 0 && ny < this.size && board[ny][nx] !== 0) return true;
            }
        }
        return false;
    }

    hasStones(board) {
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (board[y][x] !== 0) return true;
            }
        }
        return false;
    }

    cloneBoard(board) {
        return board.map(row => [...row]);
    }
}

self.onmessage = function (e) {
    const { board, size, aiColor, koPoint, iterations, moveCount } = e.data;
    const engine = new StrongBrowserGoAI(size, aiColor);
    const maxIterations = Number.isFinite(iterations)
        ? Math.max(1, Math.min(6000, Math.floor(iterations)))
        : 1200;
    const move = engine.search(board, koPoint, maxIterations, moveCount || 0);
    self.postMessage({ move });
};