const canvas = document.getElementById('goBoard');
const ctx = canvas.getContext('2d');
const turnIndicator = document.getElementById('turnIndicator');
const messageBox = document.getElementById('messageBox');
const blackCapEl = document.getElementById('blackCaptures');
const whiteCapEl = document.getElementById('whiteCaptures');

const DIFFICULTY_ITERATIONS = {
    easy: 200,
    medium: 750,
    hard: 2200
};

let BOARD_SIZE = 9;
let CELL_SIZE = 0;
const PADDING = 30;

let board = [];
let currentPlayer = 1; // 1 = Đen (Người), 2 = Trắng (AI)
let captures = { 1: 0, 2: 0 };
let koPoint = null;
let lastMove = null;
let passCount = 0;
let moveCount = 0;
let gameOver = false;
let isAiThinking = false;
let aiWorker = null;

function createWorker() {
    if (aiWorker) {
        aiWorker.terminate();
    }
    aiWorker = new Worker('ai-worker.js');
    aiWorker.onmessage = function (e) {
        const { move } = e.data;
        isAiThinking = false;
        if (move) {
            placeStone(move.x, move.y, 2);
        } else {
            handlePass(true);
        }
    };
}

function initGame() {
    BOARD_SIZE = parseInt(document.getElementById('sizeSelect').value, 10);
    const maxCanvasSize = Math.min(window.innerWidth - 40, 560);
    canvas.width = maxCanvasSize;
    canvas.height = maxCanvasSize;
    CELL_SIZE = (canvas.width - PADDING * 2) / (BOARD_SIZE - 1);

    board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
    currentPlayer = 1;
    captures = { 1: 0, 2: 0 };
    koPoint = null;
    lastMove = null;
    passCount = 0;
    moveCount = 0;
    gameOver = false;
    isAiThinking = false;

    createWorker();
    updateUI();
    drawBoard();
    setMessage('Bạn cầm quân Đen (MCTS đang chạy trên Web Worker).');
}

function resetGame() {
    initGame();
}

document.getElementById('sizeSelect').addEventListener('change', resetGame);

function getNeighbors(x, y) {
    const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    const res = [];
    for (const [dx, dy] of dirs) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < BOARD_SIZE && ny >= 0 && ny < BOARD_SIZE) {
            res.push([nx, ny]);
        }
    }
    return res;
}

function getGroupAndLiberties(targetBoard, startX, startY) {
    const color = targetBoard[startY][startX];
    const visited = new Set([`${startX},${startY}`]);
    const liberties = new Set();
    const stones = [];
    const queue = [[startX, startY]];

    while (queue.length > 0) {
        const [cx, cy] = queue.shift();
        stones.push([cx, cy]);
        for (const [nx, ny] of getNeighbors(cx, cy)) {
            const key = `${nx},${ny}`;
            if (targetBoard[ny][nx] === 0) {
                liberties.add(key);
            } else if (targetBoard[ny][nx] === color && !visited.has(key)) {
                visited.add(key);
                queue.push([nx, ny]);
            }
        }
    }
    return { stones, liberties: liberties.size };
}

function placeStone(x, y, player) {
    if (gameOver) return false;
    if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return false;
    if (board[y][x] !== 0) return false;

    if (koPoint && koPoint.x === x && koPoint.y === y) {
        setMessage('Nước đi vi phạm luật Cướp cờ (Ko)!');
        return false;
    }

    const opponent = player === 1 ? 2 : 1;
    const tempBoard = board.map(row => [...row]);
    tempBoard[y][x] = player;

    let capturedStones = [];
    for (const [nx, ny] of getNeighbors(x, y)) {
        if (tempBoard[ny][nx] === opponent) {
            const group = getGroupAndLiberties(tempBoard, nx, ny);
            if (group.liberties === 0) {
                capturedStones.push(...group.stones);
            }
        }
    }

    for (const [sx, sy] of capturedStones) {
        tempBoard[sy][sx] = 0;
    }

    const myGroup = getGroupAndLiberties(tempBoard, x, y);
    if (myGroup.liberties === 0) {
        setMessage('Nước đi tự sát không hợp lệ!');
        return false;
    }

    if (capturedStones.length === 1 && myGroup.stones.length === 1 && myGroup.liberties === 1) {
        koPoint = { x: capturedStones[0][0], y: capturedStones[0][1] };
    } else {
        koPoint = null;
    }

    board = tempBoard;
    captures[player] += capturedStones.length;
    lastMove = { x, y };
    passCount = 0;
    moveCount++;
    currentPlayer = opponent;

    updateUI();
    drawBoard();
    setMessage('');
    return true;
}

function triggerAiMove() {
    if (gameOver || currentPlayer !== 2) return;
    isAiThinking = true;
    const level = document.getElementById('difficultySelect').value;
    const iterations = DIFFICULTY_ITERATIONS[level] || 750;

    turnIndicator.textContent = `Máy đang nghĩ (${iterations} lượt MCTS)...`;
    turnIndicator.style.color = '#fbc531';

    aiWorker.postMessage({
        board,
        size: BOARD_SIZE,
        aiColor: 2,
        koPoint,
        iterations,
        moveCount
    });
}

canvas.addEventListener('click', (e) => {
    if (gameOver || isAiThinking || currentPlayer !== 1) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left - PADDING) / CELL_SIZE);
    const y = Math.round((e.clientY - rect.top - PADDING) / CELL_SIZE);

    if (placeStone(x, y, 1) && !gameOver) {
        triggerAiMove();
    }
});

function handlePass(isByAi = false) {
    if (gameOver) return;
    if (isAiThinking && !isByAi) return;

    const who = currentPlayer === 1 ? 'Đen (Bạn)' : 'Trắng (Máy)';
    passCount++;
    koPoint = null;

    if (passCount >= 2) {
        gameOver = true;
        setMessage('Cả hai bên đều bỏ lượt. Ván đấu kết thúc!');
        calculateFinalScore();
        updateUI();
        return;
    }

    setMessage(`${who} đã bỏ lượt (Pass).`);
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    updateUI();

    if (currentPlayer === 2 && !isByAi) {
        triggerAiMove();
    }
}

function calculateFinalScore() {
    const visited = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(false));
    let blackTerritory = 0;
    let whiteTerritory = 0;

    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (board[y][x] === 0 && !visited[y][x]) {
                const region = [];
                const borders = new Set();
                const queue = [[x, y]];
                visited[y][x] = true;

                while (queue.length > 0) {
                    const [cx, cy] = queue.shift();
                    region.push([cx, cy]);
                    for (const [nx, ny] of getNeighbors(cx, cy)) {
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
                    if (owner === 1) blackTerritory += region.length;
                    if (owner === 2) whiteTerritory += region.length;
                }
            }
        }
    }

    const komi = 6.5;
    const blackTotal = blackTerritory + captures[1];
    const whiteTotal = whiteTerritory + captures[2] + komi;
    const winner = blackTotal > whiteTotal ? 'Đen (Bạn)' : 'Trắng (Máy)';

    setMessage(
        `Kết quả: Đen ${blackTotal} điểm (Đất: ${blackTerritory} + Bắt: ${captures[1]}) | ` +
        `Trắng ${whiteTotal} điểm (Đất: ${whiteTerritory} + Bắt: ${captures[2]} + Komi ${komi}) -> ${winner} thắng!`
    );
}

function getStarPoints() {
    if (BOARD_SIZE === 9) return [[2, 2], [6, 2], [2, 6], [6, 6], [4, 4]];
    if (BOARD_SIZE === 13) return [[3, 3], [9, 3], [3, 9], [9, 9], [6, 6]];
    return [[3, 3], [9, 3], [15, 3], [3, 9], [9, 9], [15, 9], [3, 15], [9, 15], [15, 15]];
}

function drawBoard() {
    ctx.fillStyle = '#dcb35c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#3b2d18';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < BOARD_SIZE; i++) {
        const pos = PADDING + i * CELL_SIZE;
        ctx.beginPath();
        ctx.moveTo(PADDING, pos);
        ctx.lineTo(canvas.width - PADDING, pos);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(pos, PADDING);
        ctx.lineTo(pos, canvas.height - PADDING);
        ctx.stroke();
    }

    ctx.fillStyle = '#2b2010';
    for (const [sx, sy] of getStarPoints()) {
        ctx.beginPath();
        ctx.arc(PADDING + sx * CELL_SIZE, PADDING + sy * CELL_SIZE, 3.8, 0, Math.PI * 2);
        ctx.fill();
    }

    const stoneRadius = CELL_SIZE * 0.45;
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if (board[y][x] !== 0) {
                drawStone(x, y, board[y][x], stoneRadius);
            }
        }
    }

    if (lastMove) {
        const cx = PADDING + lastMove.x * CELL_SIZE;
        const cy = PADDING + lastMove.y * CELL_SIZE;
        ctx.strokeStyle = board[lastMove.y][lastMove.x] === 1 ? '#fff' : '#000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, stoneRadius * 0.45, 0, Math.PI * 2);
        ctx.stroke();
    }

    if (koPoint) {
        const kx = PADDING + koPoint.x * CELL_SIZE;
        const ky = PADDING + koPoint.y * CELL_SIZE;
        ctx.strokeStyle = '#e84118';
        ctx.lineWidth = 2;
        const s = stoneRadius * 0.35;
        ctx.strokeRect(kx - s, ky - s, s * 2, s * 2);
    }
}

function drawStone(x, y, color, radius) {
    const cx = PADDING + x * CELL_SIZE;
    const cy = PADDING + y * CELL_SIZE;

    ctx.beginPath();
    ctx.arc(cx + 2, cy + 2, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();

    const grad = ctx.createRadialGradient(
        cx - radius * 0.3, cy - radius * 0.3, radius * 0.1,
        cx, cy, radius
    );
    if (color === 1) {
        grad.addColorStop(0, '#555');
        grad.addColorStop(1, '#0a0a0a');
    } else {
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(1, '#cccccc');
    }

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
}

function updateUI() {
    blackCapEl.textContent = captures[1];
    whiteCapEl.textContent = captures[2];
    if (!gameOver) {
        turnIndicator.textContent = currentPlayer === 1 ? 'Lượt: Đen (Bạn)' : 'Lượt: Trắng (Máy)';
        turnIndicator.style.color = currentPlayer === 1 ? '#4cd137' : '#00a8ff';
    } else {
        turnIndicator.textContent = 'Kết thúc';
        turnIndicator.style.color = '#e84118';
    }
}

function setMessage(msg) {
    messageBox.textContent = msg;
}

initGame();