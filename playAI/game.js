import { KataGoEngineClient } from 'katago-web';
import kataModelUrl from './katago/kata.bin?url';

const kataGoClient = new KataGoEngineClient();
// Use the WASM backend explicitly. Some browsers/graphics drivers expose WebGPU
// but fail while compiling KataGo's GPU shaders (including fragment shaders).
const kataGoBackend = 'wasm';
const DIFFICULTY_VISITS = {
    easy: 200,
    medium: 750,
    hard: 2200
};

const canvas = document.getElementById('goBoard');
const ctx = canvas.getContext('2d');
const turnIndicator = document.getElementById('turnIndicator');
const messageBox = document.getElementById('messageBox');
const blackCapEl = document.getElementById('blackCaptures');
const whiteCapEl = document.getElementById('whiteCaptures');
const suggestionStatus = document.getElementById('suggestionStatus');
const suggestionDetails = document.getElementById('suggestionDetails');
const suggestionMoveEl = document.getElementById('suggestionMove');
const suggestionComparison = document.getElementById('suggestionComparison');
const suggestionEvaluation = document.getElementById('suggestionEvaluation');
const suggestionReasons = document.getElementById('suggestionReasons');

let BOARD_SIZE = 9;
let CELL_SIZE = 0;
const PADDING = 30;

let board = [];
let moveHistory = [];
let humanPlayer = 1;
let aiPlayer = 2;
let currentPlayer = 1;
let captures = { 1: 0, 2: 0 };
let koPoint = null;
let lastMove = null;
let suggestedMove = null;
let passCount = 0;
let gameOver = false;
let isAiThinking = false;
let gameGeneration = 0;
let kataGoInitialized = false;

kataGoClient.onLoadProgress(({ stage, percent }) => {
    if (isAiThinking && !kataGoInitialized) {
        turnIndicator.textContent = `Đang nạp KataGo (${stage}: ${Math.round(percent)}%)`;
    }
});

function initGame() {
    gameGeneration++;
    kataGoClient.cancelGroup('interactive');
    BOARD_SIZE = parseInt(document.getElementById('sizeSelect').value, 10);
    const maxCanvasSize = Math.min(window.innerWidth - 40, 560);
    canvas.width = maxCanvasSize;
    canvas.height = maxCanvasSize;
    CELL_SIZE = (canvas.width - PADDING * 2) / (BOARD_SIZE - 1);

    board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
    moveHistory = [];
    humanPlayer = Math.random() < 0.5 ? 1 : 2;
    aiPlayer = humanPlayer === 1 ? 2 : 1;
    currentPlayer = 1;
    captures = { 1: 0, 2: 0 };
    koPoint = null;
    lastMove = null;
    suggestedMove = null;
    passCount = 0;
    gameOver = false;
    isAiThinking = false;

    updateUI();
    drawBoard();
    resetSuggestion();
    setMessage(`Ván mới: bạn cầm quân ${getColorName(humanPlayer)}. KataGo sẽ phân tích trên thiết bị của bạn.`);
    if (currentPlayer === aiPlayer) {
        triggerAiMove();
    }
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

function inspectMove(targetBoard, move, player) {
    const opponent = player === 1 ? 2 : 1;
    const nextBoard = targetBoard.map(row => [...row]);
    nextBoard[move.y][move.x] = player;

    const capturedStones = new Set();
    for (const [nx, ny] of getNeighbors(move.x, move.y)) {
        if (nextBoard[ny][nx] !== opponent) continue;

        const group = getGroupAndLiberties(nextBoard, nx, ny);
        if (group.liberties === 0) {
            for (const [sx, sy] of group.stones) {
                capturedStones.add(`${sx},${sy}`);
            }
        }
    }

    for (const key of capturedStones) {
        const [x, y] = key.split(',').map(Number);
        nextBoard[y][x] = 0;
    }

    const friendlyGroups = new Map();
    for (const [nx, ny] of getNeighbors(move.x, move.y)) {
        if (targetBoard[ny][nx] !== player) continue;
        const group = getGroupAndLiberties(targetBoard, nx, ny);
        const key = `${group.stones[0][0]},${group.stones[0][1]}`;
        friendlyGroups.set(key, group);
    }

    const ownGroup = getGroupAndLiberties(nextBoard, move.x, move.y);
    const rescuedStones = [...friendlyGroups.values()]
        .filter(group => group.liberties === 1)
        .reduce((count, group) => count + group.stones.length, 0);

    return {
        capturedCount: capturedStones.size,
        connectedGroupCount: friendlyGroups.size,
        liberties: ownGroup.liberties,
        rescuedStones
    };
}

function getGoCoordinate(x, y) {
    const column = String.fromCharCode(65 + x + (x >= 8 ? 1 : 0));
    return `${column}${BOARD_SIZE - y}`;
}

function getColorName(player) {
    return player === 1 ? 'Đen' : 'Trắng';
}

function getPlayerName(player) {
    return `${getColorName(player)} (${player === humanPlayer ? 'Bạn' : 'Máy'})`;
}

function resetSuggestion() {
    suggestionStatus.textContent = 'Sau mỗi nước đi của bạn, KataGo sẽ phân tích một phương án khác để bạn tham khảo.';
    suggestionDetails.hidden = true;
    suggestionEvaluation.textContent = '';
    suggestionEvaluation.removeAttribute('data-rating');
    suggestionReasons.replaceChildren();
}

function showSuggestionLoading() {
    suggestedMove = null;
    suggestionStatus.textContent = 'Đang phân tích vị trí trước nước đi của bạn...';
    suggestionDetails.hidden = true;
    suggestionEvaluation.textContent = '';
    suggestionEvaluation.removeAttribute('data-rating');
    suggestionReasons.replaceChildren();
    drawBoard();
}

function showSuggestionError(error) {
    suggestionStatus.textContent = `Không phân tích được nước gợi ý: ${error}`;
    suggestionDetails.hidden = true;
}

function buildSuggestionReasons(position, playedMove, recommendedMove) {
    const recommended = inspectMove(position.board, recommendedMove, humanPlayer);
    const played = inspectMove(position.board, playedMove, humanPlayer);
    const opponentColor = getColorName(aiPlayer);
    const humanColor = getColorName(humanPlayer);
    const reasons = [];

    if (played.capturedCount > 0) {
        reasons.push(`Nước bạn vừa đi ${getGoCoordinate(playedMove.x, playedMove.y)} đã bắt ${played.capturedCount} quân ${opponentColor}.`);
    }
    if (recommended.capturedCount > 0) {
        reasons.push(`Nếu đi ${getGoCoordinate(recommendedMove.x, recommendedMove.y)}, bạn sẽ bắt ${recommended.capturedCount} quân ${opponentColor}. Một nhóm hết khí (không còn giao điểm trống liền kề) sẽ bị nhấc khỏi bàn.`);
    }
    if (recommended.capturedCount > played.capturedCount) {
        reasons.push(`So với nước bạn vừa đi, phương án này bắt nhiều hơn ${recommended.capturedCount - played.capturedCount} quân.`);
    }
    if (recommended.rescuedStones > 0) {
        reasons.push(`Điểm này nối với nhóm ${humanColor} đang chỉ còn 1 khí, giúp ${recommended.rescuedStones} quân có thêm đường thở. Khi các nhóm nối nhau, chúng có thể dùng chung khí.`);
    }
    if (recommended.connectedGroupCount >= 2) {
        reasons.push(`Nước này nối ${recommended.connectedGroupCount} nhóm ${humanColor} đang tách rời. Các nhóm hỗ trợ nhau thường khó bị vây bắt hơn, dù vẫn cần theo dõi các khí.`);
    }
    if (recommended.liberties === 1) {
        reasons.push(`Cẩn thận: sau nước này, nhóm mới chỉ còn 1 khí. ${opponentColor} có thể đe dọa bắt nhóm ngay lượt sau nếu bạn không có cách thoát hoặc phản công.`);
    } else {
        reasons.push(`Sau nước này, nhóm ${humanColor} có ${recommended.liberties} khí. Khí là giao điểm trống kề nhóm; càng có nhiều khí thì đối thủ thường càng khó bắt ngay.`);
    }
    if (played.liberties === 1 && recommended.liberties > played.liberties) {
        reasons.push(`Nhóm ở nước bạn vừa đi chỉ còn 1 khí, còn phương án ${getGoCoordinate(recommendedMove.x, recommendedMove.y)} có ${recommended.liberties} khí theo luật hiện tại.`);
    }

    const distanceToEdge = Math.min(
        recommendedMove.x,
        recommendedMove.y,
        BOARD_SIZE - 1 - recommendedMove.x,
        BOARD_SIZE - 1 - recommendedMove.y
    );
    if (distanceToEdge <= 1) {
        reasons.push('Nước này ở gần góc hoặc biên. Biên bàn cờ giúp khép một phía, nên quân thường dễ tạo đất hơn so với vùng giữa; đổi lại, vùng mở rộng cũng hẹp hơn.');
    }
    if (reasons.length === 0) {
        reasons.push('Trong khu vực này không có bắt quân hoặc cứu nhóm rõ ràng. KataGo vẫn xếp điểm này đầu trong lượt tìm kiếm nhờ đánh giá toàn bàn; phần giải thích chỉ nêu các tác động luật có thể kiểm tra trực tiếp.');
    }

    return reasons;
}

function evaluatePlayedMove(playedMove, recommendedMove, suggestionAnalysis, resultingPositionAnalysis) {
    if (recommendedMove.x === playedMove.x && recommendedMove.y === playedMove.y) {
        return {
            rating: 'best',
            text: 'NƯỚC CHUẨN! Bạn đã chọn đúng nước đặt quân KataGo xếp đầu trong lượt tìm kiếm này.'
        };
    }

    const sideToMoveSign = humanPlayer === 1 ? 1 : -1;
    const playedCandidate = suggestionAnalysis.moves.find(move => (
        move.x === playedMove.x && move.y === playedMove.y
    ));
    if (!playedCandidate && !resultingPositionAnalysis) {
        return {
            rating: '',
            text: 'KataGo đang đối chiếu thêm vị trí để xếp loại nước vừa đi chính xác hơn...'
        };
    }
    const playedWinRate = playedCandidate?.winRate ?? resultingPositionAnalysis?.rootWinRate;
    if (!Number.isFinite(recommendedMove.winRate) || !Number.isFinite(playedWinRate)) {
        return {
            rating: '',
            text: 'Chưa đủ dữ liệu để xếp loại nước vừa đi; KataGo chưa có đủ đánh giá win rate để so sánh.'
        };
    }

    const winRateLoss = Math.max(0, sideToMoveSign * (recommendedMove.winRate - playedWinRate));
    const lossPercent = Math.round(winRateLoss * 100);
    if (winRateLoss <= 0.05) {
        return {
            rating: 'good',
            text: `NƯỚC TỐT! Win rate ước tính chỉ thấp hơn phương án đầu khoảng ${lossPercent} điểm phần trăm; bạn vẫn giữ được thế chơi gần tương đương.`
        };
    }
    return {
        rating: 'bad',
        text: `NƯỚC TỆ! Ôi, win rate ước tính giảm khoảng ${lossPercent} điểm phần trăm so với phương án đầu. Hãy cân nhắc ${getGoCoordinate(recommendedMove.x, recommendedMove.y)} để giữ thế tốt hơn.`
    };
}

function showMoveSuggestion(position, playedMove, recommendedMove, suggestionAnalysis, resultingPositionAnalysis) {
    suggestedMove = recommendedMove;
    const playedCoordinate = getGoCoordinate(playedMove.x, playedMove.y);
    const recommendedCoordinate = getGoCoordinate(recommendedMove.x, recommendedMove.y);

    suggestionStatus.textContent = recommendedMove.x === playedMove.x && recommendedMove.y === playedMove.y
        ? 'Bạn đã chọn đúng nước đặt quân được KataGo ưu tiên trong lượt phân tích này.'
        : 'KataGo tìm thấy một phương án khác để bạn so sánh với nước vừa đi.';
    suggestionMoveEl.textContent = `Nước giả lập: ${recommendedCoordinate}`;
    suggestionComparison.textContent = recommendedMove.x === playedMove.x && recommendedMove.y === playedMove.y
        ? `Bạn vừa đi ${playedCoordinate}; điểm gợi ý trùng với nước của bạn.`
        : `Bạn vừa đi ${playedCoordinate}. Điểm mờ ${recommendedCoordinate} là phương án thay thế, được phân tích trên bàn cờ trước nước vừa rồi.`;

    const evaluation = evaluatePlayedMove(
        playedMove,
        recommendedMove,
        suggestionAnalysis,
        resultingPositionAnalysis
    );
    suggestionEvaluation.textContent = evaluation.text;
    if (evaluation.rating) {
        suggestionEvaluation.dataset.rating = evaluation.rating;
    } else {
        suggestionEvaluation.removeAttribute('data-rating');
    }

    suggestionReasons.replaceChildren();
    for (const reason of buildSuggestionReasons(position, playedMove, recommendedMove)) {
        const item = document.createElement('li');
        item.textContent = reason;
        suggestionReasons.append(item);
    }
    suggestionDetails.hidden = false;
    drawBoard();
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
    moveHistory.push({ x, y, player: player === 1 ? 'black' : 'white' });
    passCount = 0;
    currentPlayer = opponent;

    updateUI();
    drawBoard();
    setMessage('');
    return true;
}

async function triggerAiMove(playerMoveContext = null) {
    if (gameOver || currentPlayer !== aiPlayer) return;
    isAiThinking = true;
    const requestGeneration = gameGeneration;
    const level = document.getElementById('difficultySelect').value;
    const visits = DIFFICULTY_VISITS[level] || 750;
    let pendingSuggestion = null;

    if (playerMoveContext) {
        showSuggestionLoading();
        turnIndicator.textContent = 'KataGo đang phân tích nước vừa đi...';
    } else {
        turnIndicator.textContent = `KataGo đang tìm (${visits} lượt)...`;
    }
    turnIndicator.style.color = '#fbc531';

    try {
        if (!kataGoInitialized) {
            setMessage('Đang tải và khởi tạo model KataGo (~282 MB); lần đầu có thể mất một lúc.');
            await kataGoClient.init(kataModelUrl, kataGoBackend);
            kataGoInitialized = true;
        }
        if (requestGeneration !== gameGeneration) return;

        if (playerMoveContext) {
            try {
                const suggestionAnalysis = await kataGoClient.analyze({
                    analysisGroup: 'interactive',
                    modelUrl: kataModelUrl,
                    board: playerMoveContext.position.board.map(row => row.map(stone => (
                        stone === 1 ? 'black' : stone === 2 ? 'white' : null
                    ))),
                    koPoint: playerMoveContext.position.koPoint
                        ? playerMoveContext.position.koPoint.y * BOARD_SIZE + playerMoveContext.position.koPoint.x
                        : undefined,
                    currentPlayer: humanPlayer === 1 ? 'black' : 'white',
                    moveHistory: playerMoveContext.position.moveHistory.slice(-5),
                    komi: 6.5,
                    rules: 'japanese',
                    visits: Math.min(visits, 300),
                    maxTimeMs: 15000,
                    topK: 5,
                    analysisPvLen: 5,
                    ownershipMode: 'none',
                    conservativePass: true
                });
                if (requestGeneration !== gameGeneration) return;

                const recommendation = suggestionAnalysis.moves?.find(move => (
                    Number.isInteger(move.x) &&
                    Number.isInteger(move.y) &&
                    move.x >= 0 &&
                    move.x < BOARD_SIZE &&
                    move.y >= 0 &&
                    move.y < BOARD_SIZE &&
                    playerMoveContext.position.board[move.y][move.x] === 0 &&
                    !(playerMoveContext.position.koPoint &&
                        playerMoveContext.position.koPoint.x === move.x &&
                        playerMoveContext.position.koPoint.y === move.y)
                ));
                if (!recommendation) {
                    showSuggestionError('KataGo không trả về nước đặt quân hợp lệ.');
                } else {
                    pendingSuggestion = {
                        position: playerMoveContext.position,
                        move: playerMoveContext.move,
                        recommendation,
                        analysis: suggestionAnalysis
                    };
                    showMoveSuggestion(
                        pendingSuggestion.position,
                        pendingSuggestion.move,
                        pendingSuggestion.recommendation,
                        pendingSuggestion.analysis,
                        null
                    );
                }
            } catch (error) {
                if (requestGeneration !== gameGeneration) return;
                const detail = error instanceof Error ? error.message : String(error);
                showSuggestionError(detail);
            }
        }
        if (requestGeneration !== gameGeneration) return;

        turnIndicator.textContent = `KataGo đang tìm (${visits} lượt)...`;
        const analysis = await kataGoClient.analyze({
            analysisGroup: 'interactive',
            modelUrl: kataModelUrl,
            board: board.map(row => row.map(stone => (
                stone === 1 ? 'black' : stone === 2 ? 'white' : null
            ))),
            koPoint: koPoint ? koPoint.y * BOARD_SIZE + koPoint.x : undefined,
            currentPlayer: aiPlayer === 1 ? 'black' : 'white',
            moveHistory: moveHistory.slice(-5),
            komi: 6.5,
            rules: 'japanese',
            visits,
            maxTimeMs: level === 'hard' ? 60000 : level === 'medium' ? 30000 : 15000,
            topK: 10,
            analysisPvLen: 8,
            ownershipMode: 'none',
            conservativePass: true
        });
        if (requestGeneration !== gameGeneration) return;

        if (pendingSuggestion) {
            showMoveSuggestion(
                pendingSuggestion.position,
                pendingSuggestion.move,
                pendingSuggestion.recommendation,
                pendingSuggestion.analysis,
                analysis
            );
            pendingSuggestion = null;
        }

        const isOpeningPhase = moveHistory.length < 2;
        const firstCandidate = analysis.moves[0];
        const isLegalOpeningMove = move => (
            move &&
            Number.isInteger(move.x) &&
            Number.isInteger(move.y) &&
            move.x >= 0 &&
            move.y >= 0 &&
            move.x < BOARD_SIZE &&
            move.y < BOARD_SIZE &&
            board[move.y][move.x] === 0 &&
            !(koPoint && koPoint.x === move.x && koPoint.y === move.y) &&
            inspectMove(board, move, aiPlayer).liberties > 0
        );
        const legalAnalyzedMove = analysis.moves.find(isLegalOpeningMove);
        const policyOpeningMove = isOpeningPhase
            ? Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => ({
                x: index % BOARD_SIZE,
                y: Math.floor(index / BOARD_SIZE),
                prior: analysis.policy[index]
            }))
                .filter(move => isLegalOpeningMove(move) && Number.isFinite(move.prior) && move.prior >= 0)
                .sort((a, b) => b.prior - a.prior)[0]
            : null;
        const bestMove = isOpeningPhase
            ? (isLegalOpeningMove(firstCandidate) ? firstCandidate : legalAnalyzedMove || policyOpeningMove)
            : firstCandidate;
        if (!bestMove || bestMove.x < 0 || bestMove.y < 0) {
            if (isOpeningPhase) {
                throw new Error('KataGo không có nước khai cuộc hợp lệ.');
            }
            handlePass(true);
        } else if (
            bestMove.x >= BOARD_SIZE ||
            bestMove.y >= BOARD_SIZE ||
            board[bestMove.y][bestMove.x] !== 0 ||
            (koPoint && koPoint.x === bestMove.x && koPoint.y === bestMove.y)
        ) {
            throw new Error(`KataGo returned an illegal move (${bestMove.x}, ${bestMove.y}).`);
        } else if (!placeStone(bestMove.x, bestMove.y, aiPlayer)) {
            throw new Error(`KataGo move (${bestMove.x}, ${bestMove.y}) was rejected by the game rules.`);
        }
    } catch (error) {
        if (requestGeneration === gameGeneration) {
            if (pendingSuggestion) {
                showMoveSuggestion(
                    pendingSuggestion.position,
                    pendingSuggestion.move,
                    pendingSuggestion.recommendation,
                    pendingSuggestion.analysis,
                    null
                );
            }
            const detail = error instanceof Error ? error.message : String(error);
            setMessage(`Lỗi KataGo: ${detail}`);
        }
    } finally {
        if (requestGeneration === gameGeneration) {
            isAiThinking = false;
            updateUI();
        }
    }
}

canvas.addEventListener('click', (e) => {
    if (gameOver || isAiThinking || currentPlayer !== humanPlayer) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left - PADDING) / CELL_SIZE);
    const y = Math.round((e.clientY - rect.top - PADDING) / CELL_SIZE);
    const position = {
        board: board.map(row => [...row]),
        koPoint: koPoint ? { ...koPoint } : null,
        moveHistory: [...moveHistory]
    };

    if (placeStone(x, y, humanPlayer) && !gameOver) {
        triggerAiMove({ position, move: { x, y } });
    }
});

function handlePass(isByAi = false) {
    if (gameOver) return;
    if (isAiThinking && !isByAi) return;
    if (!isByAi && currentPlayer !== humanPlayer) {
        setMessage('Chưa đến lượt của bạn để bỏ lượt.');
        return;
    }
    if (isByAi && currentPlayer !== aiPlayer) return;

    const who = getPlayerName(currentPlayer);
    if (currentPlayer === humanPlayer && !isByAi) {
        suggestedMove = null;
        suggestionStatus.textContent = 'Bạn đã bỏ lượt, nên không có nước đặt quân để so sánh.';
        suggestionDetails.hidden = true;
        drawBoard();
    }
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

    if (currentPlayer === aiPlayer && !isByAi) {
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

    if (suggestedMove) {
        const sx = PADDING + suggestedMove.x * CELL_SIZE;
        const sy = PADDING + suggestedMove.y * CELL_SIZE;
        ctx.save();
        ctx.globalAlpha = board[suggestedMove.y][suggestedMove.x] === 0 ? 0.55 : 0.9;
        ctx.strokeStyle = '#00a8ff';
        ctx.lineWidth = Math.max(2, CELL_SIZE * 0.06);
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(sx, sy, stoneRadius * 0.82, 0, Math.PI * 2);
        ctx.stroke();
        if (board[suggestedMove.y][suggestedMove.x] === 0) {
            ctx.fillStyle = '#4cd137';
            ctx.beginPath();
            ctx.arc(sx, sy, stoneRadius * 0.55, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
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
        turnIndicator.textContent = `Lượt: ${getPlayerName(currentPlayer)}`;
        turnIndicator.style.color = currentPlayer === humanPlayer ? '#4cd137' : '#00a8ff';
    } else {
        turnIndicator.textContent = 'Kết thúc';
        turnIndicator.style.color = '#e84118';
    }
}

function setMessage(msg) {
    messageBox.textContent = msg;
}

window.resetGame = resetGame;
window.handlePass = handlePass;
window.calculateFinalScore = calculateFinalScore;
window.addEventListener('pagehide', () => kataGoClient.dispose(), { once: true });

initGame();