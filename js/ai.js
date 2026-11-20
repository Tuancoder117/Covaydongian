class GoAI {
    constructor(boardSize, aiColor = 2) {
        this.size = boardSize;
        this.aiColor = aiColor;
        this.playerColor = aiColor === 1 ? 2 : 1;
    }

    // Hàm chính gọi để lấy nước đi tốt nhất của máy: trả về { x, y } hoặc null (Pass)
    getBestMove(board, koPoint = null) {
        let bestScore = -Infinity;
        let bestMoves = [];

        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                // Bỏ qua ô đã có quân hoặc đang dính luật Ko
                if (board[y][x] !== 0) continue;
                if (koPoint && koPoint.x === x && koPoint.y === y) continue;

                // Mô phỏng đặt quân để kiểm tra tính hợp lệ và chấm điểm
                const evaluation = this.evaluateMove(board, x, y);
                
                if (evaluation.valid) {
                    if (evaluation.score > bestScore) {
                        bestScore = evaluation.score;
                        bestMoves = [{ x, y }];
                    } else if (evaluation.score === bestScore) {
                        bestMoves.push({ x, y });
                    }
                }
            }
        }

        // Nếu không còn nước đi hợp lệ hoặc điểm quá thấp (cuối ván), máy chọn Pass
        if (bestMoves.length === 0 || bestScore < -50) {
            return null; 
        }

        // Chọn ngẫu nhiên trong các nước có điểm cao nhất để lối đánh tự nhiên hơn
        const randomIndex = Math.floor(Math.random() * bestMoves.length);
        return bestMoves[randomIndex];
    }

    evaluateMove(board, x, y) {
        // Tạo bản sao bàn cờ để tính toán thử
        const tempBoard = board.map(row => [...row]);
        tempBoard[y][x] = this.aiColor;

        let score = 0;
        let capturedStones = 0;

        // 1. Kiểm tra xem nước đi có ăn được quân đối thủ xung quanh không
        const neighbors = this.getNeighbors(x, y);
        for (const [nx, ny] of neighbors) {
            if (tempBoard[ny][nx] === this.playerColor) {
                const group = this.getGroupAndLiberties(tempBoard, nx, ny);
                if (group.liberties === 0) {
                    capturedStones += group.stones.length;
                    // Xóa quân bị ăn trên bàn cờ giả lập
                    for (const [sx, sy] of group.stones) {
                        tempBoard[sy][sx] = 0;
                    }
                } else if (group.liberties === 1) {
                    // Đẩy đối thủ vào thế Atari (còn 1 khí)
                    score += 35 * group.stones.length;
                }
            }
        }

        score += capturedStones * 100;

        // 2. Kiểm tra khí của chính nhóm quân vừa đặt (Luật chống tự sát)
        const myGroup = this.getGroupAndLiberties(tempBoard, x, y);
        if (myGroup.liberties === 0) {
            return { valid: false, score: -Infinity }; // Nước tự sát -> Không hợp lệ
        }
        if (myGroup.liberties === 1) {
            score -= 60; // Hạn chế tự đưa mình vào thế 1 khí
        }

        // 3. Kiểm tra xem có cứu được quân đồng minh đang bị Atari không
        for (const [nx, ny] of neighbors) {
            if (board[ny][nx] === this.aiColor) {
                const oldGroup = this.getGroupAndLiberties(board, nx, ny);
                if (oldGroup.liberties === 1 && myGroup.liberties > 1) {
                    score += 80 * oldGroup.stones.length; // Cứu quân thành công
                }
            }
        }

        // 4. Tránh tự lấp mắt của chính mình (nếu xung quanh toàn quân mình)
        if (this.isPotentialEye(board, x, y, this.aiColor)) {
            score -= 90;
        }

        // 5. Điểm vị trí (Ưu tiên đường 3 và 4 trên bàn cờ)
        score += this.getPositionalScore(x, y);

        // Thêm một chút nhiễu ngẫu nhiên nhỏ (0 - 5 điểm) để tránh đánh rập khuôn
        score += Math.random() * 5;

        return { valid: true, score };
    }

    // Thuật toán BFS tìm cụm quân và đếm số khí (Liberties)
    getGroupAndLiberties(board, startX, startY) {
        const color = board[startY][startX];
        const visited = new Set();
        const liberties = new Set();
        const stones = [];
        const queue = [[startX, startY]];
        visited.add(`${startX},${startY}`);

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
        const result = [];
        for (const [dx, dy] of dirs) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < this.size && ny >= 0 && ny < this.size) {
                result.push([nx, ny]);
            }
        }
        return result;
    }

    isPotentialEye(board, x, y, color) {
        const neighbors = this.getNeighbors(x, y);
        return neighbors.every(([nx, ny]) => board[ny][nx] === color);
    }

    getPositionalScore(x, y) {
        const distX = Math.min(x, this.size - 1 - x);
        const distY = Math.min(y, this.size - 1 - y);
        
        // Đường 1 (sát biên) thường yếu ở đầu game
        if (distX === 0 || distY === 0) return -5;
        // Đường 3 và 4 (index 2 và 3) là vị trí vàng để lấy đất và phát triển thế
        if ((distX === 2 || distX === 3) && (distY === 2 || distY === 3)) return 15;
        if (distX === 2 || distX === 3 || distY === 2 || distY === 3) return 8;
        
        return 2;
    }
}