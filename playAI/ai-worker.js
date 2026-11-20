/**
 * ai-worker.js - Monte Carlo Tree Search (UCT) cho Cờ Vây
 */

class MCTSNode {
    constructor(board, playerToMove, koPoint, move = null, parent = null) {
        this.board = board;
        this.playerToMove = playerToMove; // 1 = Đen, 2 = Trắng
        this.koPoint = koPoint;
        this.move = move; // { x, y } hoặc null (Pass)
        this.parent = parent;
        this.children = [];
        this.visits = 0;
        this.wins = 0; // Tính theo góc nhìn của aiColor
        this.untriedMoves = null;
    }

    isFullyExpanded() {
        return this.untriedMoves !== null && this.untriedMoves.length === 0;
    }

    bestUCTChild(explorationC = 1.41) {
        let bestChild = null;
        let bestScore = -Infinity;

        for (const child of this.children) {
            if (child.visits === 0) return child;
            const exploitation = child.wins / child.visits;
            const exploration = explorationC * Math.sqrt(Math.log(this.visits) / child.visits);
            const uct = exploitation + exploration;

            if (uct > bestScore) {
                bestScore = uct;
                bestChild = child;
            }
        }
        return bestChild;
    }
}

class GoMCTSEngine {
    constructor(size, aiColor = 2) {
        this.size = size;
        this.aiColor = aiColor;
        this.opponentColor = aiColor === 1 ? 2 : 1;
    }

    search(board, koPoint, iterations = 800, moveCount = 0) {
        // Khai cuộc nhanh trên bàn lớn để tiết kiệm thời gian
        if (moveCount < 4) {
            const opening = this.pickOpeningMove(board, koPoint);
            if (opening) return opening;
        }

        const root = new MCTSNode(
            this.cloneBoard(board),
            this.aiColor,
            koPoint ? { ...koPoint } : null
        );
        root.untriedMoves = this.getCandidateMoves(root.board, root.playerToMove, root.koPoint, moveCount);

        if (root.untriedMoves.length === 0) return null;

        const maxPlayoutSteps = this.size * this.size * 2;

        for (let i = 0; i < iterations; i++) {
            let node = root;

            // 1. SELECTION
            while (node.isFullyExpanded() && node.children.length > 0) {
                node = node.bestUCTChild(1.41);
            }

            // 2. EXPANSION
            if (!node.isFullyExpanded()) {
                const idx = Math.floor(Math.random() * node.untriedMoves.length);
                const mv = node.untriedMoves.splice(idx, 1)[0];
                const sim = this.applyMove(node.board, mv.x, mv.y, node.playerToMove, node.koPoint);

                if (sim.valid) {
                    const nextPlayer = node.playerToMove === 1 ? 2 : 1;
                    const child = new MCTSNode(sim.board, nextPlayer, sim.nextKo, mv, node);
                    child.untriedMoves = this.getCandidateMoves(child.board, nextPlayer, child.koPoint, moveCount + 10);
                    node.children.push(child);
                    node = child;
                }
            }

            // 3. SIMULATION (Playout có thiên hướng chiến thuật nhẹ)
            const winner = this.simulatePlayout(node.board, node.playerToMove, node.koPoint, maxPlayoutSteps);

            // 4. BACKPROPAGATION
            const reward = winner === this.aiColor ? 1 : (winner === 0 ? 0.5 : 0);
            while (node !== null) {
                node.visits++;
                // Đảo chiều reward nếu node đại diện cho lượt đối thủ đánh
                if (node.parent === null) {
                    node.wins += reward;
                } else {
                    const mover = node.parent.playerToMove;
                    node.wins += (mover === this.aiColor ? reward : 1 - reward);
                }
                node = node.parent;
            }
        }

        // Chọn con có số lượt thăm (visits) cao nhất — ổn định hơn điểm win trung bình
        let bestChild = null;
        let mostVisits = -1;
        for (const child of root.children) {
            if (child.visits > mostVisits) {
                mostVisits = child.visits;
                bestChild = child;
            }
        }

        return bestChild ? bestChild.move : null;
    }

    pickOpeningMove(board, koPoint) {
        const starPoints = this.size === 9
            ? [[2, 2], [6, 2], [2, 6], [6, 6], [4, 4]]
            : this.size === 13
                ? [[3, 3], [9, 3], [3, 9], [9, 9], [6, 6]]
                : [[3, 3], [9, 3], [15, 3], [3, 9], [15, 9], [3, 15], [9, 15], [15, 15]];

        const validStars = [];
        for (const [x, y] of starPoints) {
            if (board[y][x] === 0 && !(koPoint && koPoint.x === x && koPoint.y === y)) {
                validStars.push({ x, y });
            }
        }
        if (validStars.length === 0) return null;
        return validStars[Math.floor(Math.random() * validStars.length)];
    }

    getCandidateMoves(board, player, koPoint, moveCount) {
        const moves = [];
        const hasAnyStone = this.hasStones(board);

        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (board[y][x] !== 0) continue;
                if (koPoint && koPoint.x === x && koPoint.y === y) continue;

                // Sau những nước đầu, ưu tiên ô gần quân hiện có để thu hẹp không gian tìm kiếm
                if (hasAnyStone && moveCount > 2 && !this.isNearStone(board, x, y, 2)) {
                    continue;
                }

                // Bỏ qua ô tự lấp mắt hiển nhiên của chính mình
                if (this.isTrueEyeLike(board, x, y, player)) continue;

                const check = this.applyMove(board, x, y, player, koPoint);
                if (check.valid) {
                    moves.push({ x, y });
                }
            }
        }

        // Dự phòng nếu danh sách ứng viên rỗng
        if (moves.length === 0) {
            for (let y = 0; y < this.size; y++) {
                for (let x = 0; x < this.size; x++) {
                    if (board[y][x] === 0 && !(koPoint && koPoint.x === x && koPoint.y === y)) {
                        if (this.applyMove(board, x, y, player, koPoint).valid) {
                            moves.push({ x, y });
                        }
                    }
                }
            }
        }

        return moves;
    }

    simulatePlayout(startBoard, startPlayer, startKo, maxSteps) {
        let board = this.cloneBoard(startBoard);
        let player = startPlayer;
        let ko = startKo ? { ...startKo } : null;
        let consecutivePasses = 0;

        for (let step = 0; step < maxSteps; step++) {
            const move = this.pickPlayoutMove(board, player, ko);
            if (!move) {
                consecutivePasses++;
                if (consecutivePasses >= 2) break;
                ko = null;
                player = player === 1 ? 2 : 1;
                continue;
            }

            const res = this.applyMove(board, move.x, move.y, player, ko);
            if (!res.valid) {
                consecutivePasses++;
                if (consecutivePasses >= 2) break;
                player = player === 1 ? 2 : 1;
                continue;
            }

            board = res.board;
            ko = res.nextKo;
            consecutivePasses = 0;
            player = player === 1 ? 2 : 1;
        }

        return this.estimateWinner(board);
    }

    pickPlayoutMove(board, player, ko) {
        const candidates = [];
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (board[y][x] !== 0) continue;
                if (ko && ko.x === x && ko.y === y) continue;
                if (this.isTrueEyeLike(board, x, y, player)) continue;
                candidates.push({ x, y });
            }
        }

        if (candidates.length === 0) return null;

        // Lấy mẫu ngẫu nhiên tối đa 18 ô để rollout chạy thật nhanh
        const sampleSize = Math.min(18, candidates.length);
        for (let i = 0; i < sampleSize; i++) {
            const randIdx = i + Math.floor(Math.random() * (candidates.length - i));
            [candidates[i], candidates[randIdx]] = [candidates[randIdx], candidates[i]];
            const mv = candidates[i];
            const res = this.applyMove(board, mv.x, mv.y, player, ko);
            if (res.valid) return mv;
        }

        for (const mv of candidates) {
            if (this.applyMove(board, mv.x, mv.y, player, ko).valid) return mv;
        }
        return null;
    }

    estimateWinner(board) {
        const visited = Array.from({ length: this.size }, () => Array(this.size).fill(false));
        let blackScore = 0;
        let whiteScore = 6.5; // Komi mặc định cho Trắng

        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                const val = board[y][x];
                if (val === 1) {
                    blackScore++;
                } else if (val === 2) {
                    whiteScore++;
                } else if (!visited[y][x]) {
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

        const opponent = player === 1 ? 2 : 1;
        const nextBoard = this.cloneBoard(board);
        nextBoard[y][x] = player;

        let captured = [];
        for (const [nx, ny] of this.getNeighbors(x, y)) {
            if (nextBoard[ny][nx] === opponent) {
                const group = this.getGroupAndLiberties(nextBoard, nx, ny);
                if (group.liberties === 0) {
                    captured.push(...group.stones);
                }
            }
        }

        for (const [sx, sy] of captured) {
            nextBoard[sy][sx] = 0;
        }

        const myGroup = this.getGroupAndLiberties(nextBoard, x, y);
        if (myGroup.liberties === 0) {
            return { valid: false }; // Tự sát
        }

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
                if (board[ny][nx] === 0) {
                    liberties.add(key);
                } else if (board[ny][nx] === color && !visited.has(key)) {
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
            if (nx >= 0 && nx < this.size && ny >= 0 && ny < this.size) {
                res.push([nx, ny]);
            }
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
                if (nx >= 0 && nx < this.size && ny >= 0 && ny < this.size && board[ny][nx] !== 0) {
                    return true;
                }
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
    const engine = new GoMCTSEngine(size, aiColor);
    const bestMove = engine.search(board, koPoint, iterations, moveCount);
    self.postMessage({ move: bestMove });
};