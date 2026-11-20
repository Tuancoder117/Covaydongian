/**
 * GoBoardEngine - Lõi xử lý luật cờ vây & render Canvas chất lượng cao
 * Hỗ trợ bàn 9x9, 13x13, 19x19
 */
class GoBoardEngine {
    constructor(canvasId, size = 9, options = {}) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.size = size;
        this.board = this.createEmptyBoard();
        this.currentPlayer = 1; // 1 = Đen, 2 = Trắng
        this.captures = { 1: 0, 2: 0 };
        this.koPoint = null; // {x, y, forbiddenColor}: điểm cấm bắt lại ngay & bên bị cấm
        this.lastMove = null;
        this.hoverPoint = null;
        this.markers = []; // Mảng các ký hiệu gợi ý trên bàn cờ [{x, y, type, text, color}]
        this.boardColor = options.boardColor || '#e8b976';
        this.interactive = options.interactive !== undefined ? options.interactive : true;
        this.onMoveCallback = options.onMove || null;
        this.onInvalidCallback = options.onInvalid || null; // Gọi khi nước đi bị từ chối (kèm lý do)

        this.initEvents();
        this.draw();
    }

    createEmptyBoard() {
        return Array.from({ length: this.size }, () => Array(this.size).fill(0));
    }

    setSize(newSize) {
        this.size = newSize;
        this.reset();
    }

    // Bật/tắt cho phép người dùng bấm lên bàn cờ (tắt thì cũng xóa bóng xem trước)
    setInteractive(flag) {
        this.interactive = flag;
        if (!flag) this.hoverPoint = null;
        this.draw();
    }

    setBoardColor(color) {
        this.boardColor = color;
        this.draw();
    }

    reset() {
        this.board = this.createEmptyBoard();
        this.currentPlayer = 1;
        this.captures = { 1: 0, 2: 0 };
        this.koPoint = null;
        this.lastMove = null;
        this.markers = [];
        this.draw();
    }

    // Đặt thế cờ có sẵn: mảng [{x, y, color}]
    loadPosition(stones, turn = 1, markers = []) {
        this.reset();
        this.currentPlayer = turn;
        stones.forEach(s => {
            if (this.inBounds(s.x, s.y)) {
                this.board[s.y][s.x] = s.color;
            }
        });
        this.markers = markers;
        this.draw();
    }

    inBounds(x, y) {
        return x >= 0 && x < this.size && y >= 0 && y < this.size;
    }

    getNeighbors(x, y) {
        const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
        return dirs
            .map(([dx, dy]) => ({ x: x + dx, y: y + dy }))
            .filter(p => this.inBounds(p.x, p.y));
    }

    // Tìm toàn bộ đám quân liên kết và số khí của đám quân đó
    getGroupAndLiberties(x, y, tempBoard = this.board) {
        const color = tempBoard[y][x];
        if (color === 0) return { group: [], liberties: new Set() };

        const group = [];
        const liberties = new Set();
        const visited = new Set();
        const stack = [{ x, y }];
        visited.add(`${x},${y}`);

        while (stack.length > 0) {
            const curr = stack.pop();
            group.push(curr);

            for (const n of this.getNeighbors(curr.x, curr.y)) {
                const key = `${n.x},${n.y}`;
                const val = tempBoard[n.y][n.x];
                if (val === 0) {
                    liberties.add(key);
                } else if (val === color && !visited.has(key)) {
                    visited.add(key);
                    stack.push(n);
                }
            }
        }
        return { group, liberties };
    }

    // Từ chối nước đi: báo lý do cho giao diện rồi trả về kết quả không hợp lệ
    reject(reason) {
        if (this.onInvalidCallback) this.onInvalidCallback(reason);
        return { valid: false, reason };
    }

    // Thực hiện nước đi & kiểm tra toàn bộ luật cờ vây
    playMove(x, y, color = this.currentPlayer) {
        if (!this.inBounds(x, y)) return this.reject('Ngoài bàn cờ');
        if (this.board[y][x] !== 0) return this.reject('Ô này đã có quân!');

        // Kiểm tra luật Cướp (Ko): chỉ cấm đúng bên vừa bị bắt quân
        if (this.koPoint && this.koPoint.x === x && this.koPoint.y === y && this.koPoint.forbiddenColor === color) {
            return this.reject('Vi phạm luật Cướp (Ko)! Bạn phải đi nơi khác 1 nước trước khi bắt lại.');
        }

        // Tạo bản sao bàn cờ để thử nước đi
        const tempBoard = this.board.map(row => [...row]);
        tempBoard[y][x] = color;
        const opponent = color === 1 ? 2 : 1;

        // Kiểm tra xem có bắt được quân đối phương không.
        // Dùng Set để một đám quân tiếp giáp quân vừa đặt ở nhiều hướng không bị đếm 2 lần.
        const capturedKeys = new Set();
        const capturedStones = [];
        for (const n of this.getNeighbors(x, y)) {
            if (tempBoard[n.y][n.x] !== opponent) continue;
            const { group, liberties } = this.getGroupAndLiberties(n.x, n.y, tempBoard);
            if (liberties.size !== 0) continue;
            for (const s of group) {
                const key = `${s.x},${s.y}`;
                if (!capturedKeys.has(key)) {
                    capturedKeys.add(key);
                    capturedStones.push(s);
                }
            }
        }

        // Xóa quân bị bắt trên bàn cờ thử nghiệm
        capturedStones.forEach(s => {
            tempBoard[s.y][s.x] = 0;
        });

        // Kiểm tra luật Cấm Tự Sát (Suicide)
        const { group: myGroup, liberties: myLiberties } = this.getGroupAndLiberties(x, y, tempBoard);
        if (myLiberties.size === 0) {
            return this.reject('Nước đi tự sát! Quân đặt vào không còn khí nào.');
        }

        // Nước đi hợp lệ -> Cập nhật trạng thái thật
        this.board = tempBoard;
        this.captures[color] += capturedStones.length;
        this.lastMove = { x, y, color };

        // Ko chỉ xảy ra khi: bắt đúng 1 quân, quân vừa đặt đứng đơn độc (không nối với quân nào)
        // và chỉ còn đúng 1 khí. (Nếu quân vừa đặt nối với đám khác thì đó là snapback, không phải Ko.)
        if (capturedStones.length === 1 && myGroup.length === 1 && myLiberties.size === 1) {
            this.koPoint = { x: capturedStones[0].x, y: capturedStones[0].y, forbiddenColor: opponent };
        } else {
            this.koPoint = null;
        }

        this.currentPlayer = opponent;
        this.playStoneSound();
        this.draw();

        if (this.onMoveCallback) {
            this.onMoveCallback({ x, y, color, captured: capturedStones.length });
        }

        return { valid: true, captured: capturedStones.length };
    }

    // Dùng chung 1 AudioContext cho mọi nước đi (tạo mới mỗi nước sẽ rò rỉ và bị trình duyệt chặn)
    static getAudioContext() {
        if (!GoBoardEngine.sharedAudioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return null;
            GoBoardEngine.sharedAudioCtx = new Ctx();
        }
        return GoBoardEngine.sharedAudioCtx;
    }

    // Âm thanh đặt quân nhẹ nhàng tạo cảm giác chân thực
    playStoneSound() {
        try {
            const audioCtx = GoBoardEngine.getAudioContext();
            if (!audioCtx) return;
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(160, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(45, audioCtx.currentTime + 0.06);
            gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.06);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.06);
        } catch (e) { /* Bỏ qua nếu trình duyệt chặn autoplay audio */ }
    }

    initEvents() {
        this.canvas.addEventListener('mousemove', (e) => {
            if (!this.interactive) return;
            const pt = this.getGridCoords(e);
            if (!this.hoverPoint || !pt || this.hoverPoint.x !== pt.x || this.hoverPoint.y !== pt.y) {
                this.hoverPoint = pt;
                this.draw();
            }
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.hoverPoint = null;
            this.draw();
        });

        this.canvas.addEventListener('click', (e) => {
            if (!this.interactive) return;
            const pt = this.getGridCoords(e);
            if (pt) {
                this.playMove(pt.x, pt.y);
            }
        });
    }

    // Lề của bàn cờ, tỉ lệ theo kích thước canvas (canvas nhỏ như bàn cờ mini thì lề nhỏ)
    getPadding() {
        return Math.max(8, Math.round(this.canvas.width * 0.085));
    }

    getGridCoords(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const clickX = (e.clientX - rect.left) * scaleX;
        const clickY = (e.clientY - rect.top) * scaleY;

        const padding = this.getPadding();
        const cellSize = (this.canvas.width - padding * 2) / (this.size - 1);

        const gx = Math.round((clickX - padding) / cellSize);
        const gy = Math.round((clickY - padding) / cellSize);

        if (this.inBounds(gx, gy)) {
            return { x: gx, y: gy };
        }
        return null;
    }

    getStarPoints() {
        if (this.size === 9) return [[2, 2], [6, 2], [4, 4], [2, 6], [6, 6]];
        if (this.size === 13) return [[3, 3], [9, 3], [6, 6], [3, 9], [9, 9]];
        if (this.size === 19) return [
            [3, 3], [9, 3], [15, 3],
            [3, 9], [9, 9], [15, 9],
            [3, 15], [9, 15], [15, 15]
        ];
        return [];
    }

    draw() {
        const ctx = this.ctx;
        const w = this.canvas.width;
        const padding = this.getPadding();
        const cellSize = (w - padding * 2) / (this.size - 1);
        const stoneRadius = cellSize * 0.45;

        // 1. Nền gỗ
        ctx.fillStyle = this.boardColor;
        ctx.fillRect(0, 0, w, w);

        // 2. Kẻ lưới bàn cờ
        ctx.strokeStyle = '#3e2723';
        ctx.lineWidth = 1.2;
        for (let i = 0; i < this.size; i++) {
            const pos = padding + i * cellSize;
            // Đường ngang
            ctx.beginPath();
            ctx.moveTo(padding, pos);
            ctx.lineTo(w - padding, pos);
            ctx.stroke();
            // Đường dọc
            ctx.beginPath();
            ctx.moveTo(pos, padding);
            ctx.lineTo(pos, w - padding);
            ctx.stroke();
        }

        // 3. Tọa độ chữ & số (A-T, 1-19) - bỏ qua với canvas nhỏ (bàn cờ mini trang trí)
        if (w >= 260) {
            ctx.fillStyle = '#5d4037';
            ctx.font = '600 11px "Be Vietnam Pro", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const letters = 'ABCDEFGHJKLMNOPQRST';
            const labelOffset = padding * 0.32; // Sát mép canvas để quân ngoài biên không che tọa độ
            for (let i = 0; i < this.size; i++) {
                const pos = padding + i * cellSize;
                ctx.fillText(letters[i], pos, labelOffset);
                ctx.fillText(letters[i], pos, w - labelOffset);
                ctx.fillText(this.size - i, labelOffset, pos);
                ctx.fillText(this.size - i, w - labelOffset, pos);
            }
        }

        // 4. Điểm sao (Hoshi)
        ctx.fillStyle = '#3e2723';
        const starRadius = Math.max(2, cellSize * 0.085);
        for (const [sx, sy] of this.getStarPoints()) {
            ctx.beginPath();
            ctx.arc(padding + sx * cellSize, padding + sy * cellSize, starRadius, 0, Math.PI * 2);
            ctx.fill();
        }

        // 5. Vẽ quân cờ
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                const stone = this.board[y][x];
                if (stone !== 0) {
                    this.drawStone(padding + x * cellSize, padding + y * cellSize, stoneRadius, stone);
                }
            }
        }

        // 6. Bóng mờ xem trước khi hover
        if (this.interactive && this.hoverPoint && this.board[this.hoverPoint.y][this.hoverPoint.x] === 0) {
            ctx.save();
            ctx.globalAlpha = 0.45;
            this.drawStone(
                padding + this.hoverPoint.x * cellSize,
                padding + this.hoverPoint.y * cellSize,
                stoneRadius,
                this.currentPlayer
            );
            ctx.restore();
        }

        // 7. Đánh dấu nước đi cuối cùng
        if (this.lastMove) {
            const lx = padding + this.lastMove.x * cellSize;
            const ly = padding + this.lastMove.y * cellSize;
            ctx.strokeStyle = this.lastMove.color === 1 ? '#ffffff' : '#000000';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(lx, ly, stoneRadius * 0.42, 0, Math.PI * 2);
            ctx.stroke();
        }

        // 8. Vẽ các ký hiệu gợi ý bài học / AI (vòng tròn, chấm, chữ cái)
        for (const m of this.markers) {
            const mx = padding + m.x * cellSize;
            const my = padding + m.y * cellSize;
            ctx.save();
            ctx.fillStyle = m.color || '#16a34a';
            ctx.strokeStyle = m.color || '#16a34a';
            ctx.lineWidth = 2.5;

            if (m.type === 'circle') {
                ctx.beginPath();
                ctx.arc(mx, my, stoneRadius * 0.48, 0, Math.PI * 2);
                ctx.stroke();
            } else if (m.type === 'dot') {
                ctx.beginPath();
                ctx.arc(mx, my, Math.max(3, cellSize * 0.13), 0, Math.PI * 2);
                ctx.fill();
            } else if (m.type === 'text') {
                ctx.font = 'bold 14px "Be Vietnam Pro", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(m.text, mx, my);
            }
            ctx.restore();
        }
    }

    drawStone(cx, cy, r, color) {
        const ctx = this.ctx;
        ctx.save();
        // Đổ bóng nhẹ
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;

        const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
        if (color === 1) {
            grad.addColorStop(0, '#475569');
            grad.addColorStop(1, '#0f172a');
        } else {
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(1, '#cbd5e1');
        }

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}
