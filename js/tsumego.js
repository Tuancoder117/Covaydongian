/**
 * TsumegoModule - Luyện sống chết & hình cờ
 * Hỗ trợ bài mẫu theo cấp độ + đọc file .SGF + buổi tập hằng ngày + cài đặt giao diện
 */

const TSUMEGO_STORAGE = {
    solved: 'cvdgl_solved_tsumego',
    settings: 'cvdgl_tsumego_settings',
    daily: 'cvdgl_daily_progress'
};

// localStorage có thể bị chặn (chế độ riêng tư) hoặc chứa dữ liệu hỏng -> luôn bọc try/catch
function storageGetJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
        return fallback;
    }
}

function storageSetJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* bỏ qua: bộ nhớ đầy hoặc bị chặn */ }
}

// Thoát ký tự HTML: tiêu đề bài (nhất là từ file SGF của người khác) không được phép chèn mã
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

class TsumegoModule {
    constructor(canvasId) {
        this.isBotThinking = false;
        this.pendingTimer = null; // Hẹn giờ hoàn tác nước sai / nước đáp trả của máy

        this.board = new GoBoardEngine(canvasId, 9, {
            interactive: true,
            onMove: (move) => this.handlePlayerMove(move),
            // Nước đi bị từ chối (ô có quân, tự sát, Ko...) -> báo lý do cho người học
            onInvalid: (reason) => {
                if (!this.isBotThinking) this.setFeedback(reason, 'error');
            }
        });

        const settings = this.getSettings();
        this.currentLevelFilter = settings.defaultLevel || 'all';
        this.problems = this.getDefaultProblems();
        this.currentProblem = null;

        const solved = storageGetJSON(TSUMEGO_STORAGE.solved, []);
        this.solvedIds = new Set(Array.isArray(solved) ? solved : []);

        this.bindEvents();
        this.applySettings(settings);
        this.syncFilterButtons();
        this.onTabShown(); // Vẽ danh sách + chọn bài đầu tiên của nhóm đang lọc
        this.syncDailyProgress();
    }

    getSettings() {
        const saved = storageGetJSON(TSUMEGO_STORAGE.settings, null);
        return {
            theme: 'kaya',
            defaultLevel: 'all',
            ...(saved && typeof saved === 'object' ? saved : {})
        };
    }

    saveSettings(partial = {}) {
        const next = { ...this.getSettings(), ...partial };
        storageSetJSON(TSUMEGO_STORAGE.settings, next);
        this.applySettings(next);
    }

    applySettings(settings = this.getSettings()) {
        const themeColors = {
            kaya: '#e8b976',
            walnut: '#c68b59',
            mint: '#a7c9a9'
        };
        const bg = themeColors[settings.theme] || '#e8b976';
        document.querySelectorAll('.canvas-wrapper').forEach(wrap => {
            wrap.style.background = bg;
        });
        // Bàn cờ tự vẽ nền gỗ lên canvas nên phải đổi màu ở cả engine thì theme mới có tác dụng
        this.board.setBoardColor(bg);
    }

    syncFilterButtons() {
        document.querySelectorAll('.tsumego-filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.level === this.currentLevelFilter);
        });
    }

    getFilteredProblems() {
        return this.currentLevelFilter === 'all'
            ? this.problems
            : this.problems.filter(p => p.level === this.currentLevelFilter);
    }

    // Gọi mỗi khi mở tab / đổi bộ lọc: đảm bảo danh sách và bài đang mở luôn khớp bộ lọc
    onTabShown() {
        const list = this.getFilteredProblems();
        const currentInList = this.currentProblem && list.some(p => p.id === this.currentProblem.id);
        if (list.length > 0 && !currentInList) {
            this.selectProblem(list[0].id); // selectProblem đã vẽ lại danh sách
        } else {
            this.renderProblemList();
        }
    }

    // ---------- Ngày & tiến độ hằng ngày ----------

    // Ngày theo giờ địa phương (toISOString() trả về giờ UTC nên sẽ sang ngày mới lệch 7 tiếng ở Việt Nam)
    todayKey() {
        const d = new Date();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${mm}-${dd}`;
    }

    // Tập id các bài đã giải TRONG HÔM NAY
    loadDailySolved() {
        const saved = storageGetJSON(TSUMEGO_STORAGE.daily, null);
        if (saved && saved.date === this.todayKey() && Array.isArray(saved.ids)) {
            return new Set(saved.ids);
        }
        return new Set();
    }

    markSolved(id) {
        this.solvedIds.add(id);
        storageSetJSON(TSUMEGO_STORAGE.solved, [...this.solvedIds]);

        const today = this.loadDailySolved();
        today.add(id);
        storageSetJSON(TSUMEGO_STORAGE.daily, { date: this.todayKey(), ids: [...today] });

        this.syncDailyProgress();
        this.renderProblemList();
    }

    // ---------- SGF ----------

    sgfCoordToXY(coord) {
        if (!coord || coord.length < 2) return null;
        const x = coord.charCodeAt(0) - 97;
        const y = coord.charCodeAt(1) - 97;
        return { x, y };
    }

    // Mã băm ngắn từ nội dung file -> id ổn định (tải lại cùng file vẫn nhớ trạng thái đã giải, không bị nhân đôi)
    hashString(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) + h + str.charCodeAt(i)) | 0;
        }
        return (h >>> 0).toString(36);
    }

    parseSGF(sgfText, fileName = 'Bài SGF') {
        const text = String(sgfText || '');

        const szMatch = text.match(/SZ\s*\[\s*(\d+)/);
        let size = szMatch ? parseInt(szMatch[1], 10) : 9;
        if (!(size >= 5 && size <= 19)) size = 9;

        // Quân đặt sẵn: gom MỌI khối AB[..][..] / AW[..][..] (cho phép khoảng trắng/xuống dòng giữa các tọa độ)
        const stones = [];
        const addColor = (tag, color) => {
            const blockRe = new RegExp(`(?:^|[^A-Za-z])${tag}((?:\\s*\\[[a-s]{2}\\])+)`, 'g');
            for (const block of text.matchAll(blockRe)) {
                for (const m of block[1].matchAll(/\[([a-s]{2})\]/g)) {
                    const pt = this.sgfCoordToXY(m[1]);
                    if (pt) stones.push({ x: pt.x, y: pt.y, color });
                }
            }
        };
        addColor('AB', 1);
        addColor('AW', 2);

        // Bên đi trước: ưu tiên PL[..]; nếu thiếu thì lấy màu của nước đi đầu tiên trong file
        const plMatch = text.match(/PL\s*\[\s*(B|W)\s*\]/i);
        let turn = plMatch ? (plMatch[1].toUpperCase() === 'W' ? 2 : 1) : 0;

        // Đọc cây nước đi: ";" là một nút kèm thuộc tính, "(" ")" mở/đóng nhánh biến.
        // Đáp án = các nước ĐẦU TIÊN của người giải (chưa có nước nào của họ trước đó trên nhánh),
        // nước đáp trả = nước đối thủ đi ngay sau đó (nhánh chính). Các nước sâu hơn trong chuỗi
        // không được coi là đáp án của nước đi đầu.
        const tokens = text.match(/\(|\)|;(?:\s*[A-Z]+(?:\s*\[(?:\\[\s\S]|[^\]\\])*\])+)*/g) || [];
        const unescape = (s) => s.replace(/\\([\]\\])/g, '$1');
        const path = [];
        const stack = [];
        const firstMoves = [];
        let pending = null; // Nước đúng đang chờ tìm nước đáp trả

        for (const tok of tokens) {
            if (tok === '(') {
                stack.push(path.length);
                continue;
            }
            if (tok === ')') {
                path.length = stack.length ? stack.pop() : 0;
                pending = null;
                continue;
            }

            const props = {};
            for (const pm of tok.matchAll(/([A-Z]+)((?:\s*\[(?:\\[\s\S]|[^\]\\])*\])+)/g)) {
                props[pm[1]] = [...pm[2].matchAll(/\[((?:\\[\s\S]|[^\]\\])*)\]/g)].map(v => v[1]);
            }
            const color = props.B ? 1 : (props.W ? 2 : 0);
            const coord = color ? (props.B || props.W)[0] : '';
            if (!color || !/^[a-s]{2}$/.test(coord)) continue; // Nút gốc, chú thích, hoặc nước "pass"
            const pt = this.sgfCoordToXY(coord);
            const key = `${pt.x},${pt.y}`;

            if (!turn) turn = color;

            if (pending) {
                if (color !== turn && !pending.reply) pending.reply = pt;
                pending = null;
            }

            const isFirstSolverMove = color === turn && !path.some(m => m.color === turn);
            path.push({ color, key });

            if (isFirstSolverMove) {
                let cand = firstMoves.find(c => c.key === key);
                if (!cand) {
                    cand = { key, comment: props.C ? unescape(props.C[0]) : '', reply: null };
                    firstMoves.push(cand);
                }
                pending = cand.reply ? null : cand;
            }
        }

        const winMoves = firstMoves.map(c => c.key);
        const replies = {};
        const explanations = {};
        firstMoves.forEach(c => {
            if (c.reply) replies[c.key] = c.reply;
            if (c.comment) explanations[c.key] = c.comment;
        });

        const titleMatch = text.match(/GN\s*\[((?:\\[\s\S]|[^\]\\])*)\]/);
        const title = titleMatch && titleMatch[1].trim()
            ? unescape(titleMatch[1].trim())
            : fileName.replace(/\.sgf$/i, '');

        return {
            id: 'sgf-' + this.hashString(text),
            title,
            level: 'sgf',
            levelLabel: 'File SGF',
            size,
            turn: turn || 1,
            hintText: 'Tìm điểm then chốt cắt khí hoặc nối quân tạo 2 mắt.',
            stones,
            winMoves,
            replies,
            explanations
        };
    }

    // Kiểm tra bài SGF có dùng được không: cần có hình cờ và có lời giải để chấm
    buildSGFProblem(sgfText, fileName) {
        const parsed = this.parseSGF(sgfText, fileName);
        if (parsed.stones.length === 0) {
            return { error: 'File không có hình cờ hợp lệ (thiếu AB/AW).' };
        }
        if (parsed.winMoves.length === 0) {
            return { error: 'File không có lời giải (thiếu nước đi B[..]/W[..]) nên không thể chấm bài.' };
        }
        return { problem: parsed };
    }

    // Thêm bài vào danh sách; nếu đã có bài cùng id (cùng nội dung) thì dùng lại, không nhân đôi
    insertProblem(parsed, atEnd = false) {
        const existing = this.problems.find(p => p.id === parsed.id);
        if (existing) return existing;
        if (atEnd) this.problems.push(parsed);
        else this.problems.unshift(parsed);
        return parsed;
    }

    importSGFText(sgfText, fileName, successMsg) {
        const { problem, error } = this.buildSGFProblem(sgfText, fileName);
        if (error) {
            this.setFeedback(error, 'error');
            return false;
        }
        const added = this.insertProblem(problem);
        this.currentLevelFilter = 'all';
        this.syncFilterButtons();
        this.selectProblem(added.id);
        this.setFeedback(successMsg || `Đã thêm bài "${added.title}" thành công!`, 'success');
        return true;
    }

    // ---------- Dữ liệu bài mẫu ----------

    getDefaultProblems() {
        return [
            {
                id: 'p1',
                title: 'Bắt quân góc trên trái',
                level: '30k-20k',
                levelLabel: '30k – 20k',
                size: 9,
                turn: 1,
                hintText: 'Quân Trắng chỉ còn 1 khí ở sát mép trên.',
                stones: [
                    { x: 1, y: 1, color: 2 },
                    { x: 0, y: 1, color: 1 },
                    { x: 1, y: 2, color: 1 },
                    { x: 2, y: 1, color: 1 }
                ],
                winMoves: ['1,0'],
                replies: {},
                explanations: {
                    '1,0': 'Chính xác! Lấp khí cuối cùng bắt gọn quân Trắng.'
                }
            },
            {
                // Vùng trống bên trong có 3 điểm THẲNG HÀNG: đi điểm giữa -> tách thành 2 mắt đơn -> sống.
                // (Bản cũ chỉ có 2 điểm trống liền nhau = một mắt hai ô, đi vào đâu cũng tự đặt mình vào thế
                // bị bắt, nên đáp án "đúng" thực ra làm chết cả khối Đen.)
                id: 'p2',
                title: 'Tạo 2 mắt để sống',
                level: '19k-10k',
                levelLabel: '19k – 10k',
                size: 9,
                turn: 1,
                hintText: 'Vùng trống bên trong có 3 điểm thẳng hàng. Đi vào điểm chính giữa để chia thành 2 mắt riêng biệt.',
                stones: [
                    // Đen: hàng trên cùng, hai cột bên và hàng thứ 3
                    { x: 0, y: 0, color: 1 }, { x: 1, y: 0, color: 1 }, { x: 2, y: 0, color: 1 }, { x: 3, y: 0, color: 1 }, { x: 4, y: 0, color: 1 },
                    { x: 0, y: 1, color: 1 }, { x: 4, y: 1, color: 1 },
                    { x: 0, y: 2, color: 1 }, { x: 1, y: 2, color: 1 }, { x: 2, y: 2, color: 1 }, { x: 3, y: 2, color: 1 }, { x: 4, y: 2, color: 1 },
                    // Trắng bao vây bên ngoài
                    { x: 5, y: 0, color: 2 }, { x: 5, y: 1, color: 2 }, { x: 5, y: 2, color: 2 },
                    { x: 0, y: 3, color: 2 }, { x: 1, y: 3, color: 2 }, { x: 2, y: 3, color: 2 }, { x: 3, y: 3, color: 2 }, { x: 4, y: 3, color: 2 }
                ],
                winMoves: ['2,1'],
                replies: {},
                explanations: {
                    '2,1': 'Đúng rồi! Điểm giữa chia vùng trống thành 2 mắt riêng biệt. Trắng không thể đánh vào cả 2 mắt cùng lúc nên khối Đen sống.'
                }
            },
            {
                id: 'p3',
                title: 'Phản kích cắt đứt',
                level: '9k-1d',
                levelLabel: '9k – 1d',
                size: 9,
                turn: 1,
                hintText: 'Chặn ngay đường nối giữa hai quân Trắng ở khu vực trung tâm.',
                stones: [
                    { x: 3, y: 3, color: 2 }, { x: 5, y: 3, color: 2 },
                    { x: 4, y: 2, color: 2 },
                    { x: 4, y: 4, color: 1 }, { x: 3, y: 4, color: 1 }, { x: 5, y: 4, color: 1 }
                ],
                winMoves: ['4,3'],
                replies: {
                    '4,3': { x: 3, y: 2 }
                },
                explanations: {
                    '4,3': 'Nước cắt chuẩn xác! Chia đôi thế liên kết của Trắng.'
                }
            }
        ];
    }

    // ---------- Sự kiện ----------

    bindEvents() {
        const fileInput = document.getElementById('sgf-file-input');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    this.importSGFText(ev.target.result, file.name, `Đã nạp bài tập từ file "${file.name}".`);
                };
                reader.onerror = () => this.setFeedback(`Không đọc được file "${file.name}".`, 'error');
                reader.readAsText(file);
                e.target.value = '';
            });
        }

        // Bấm vào bài trong danh sách (ủy quyền sự kiện, không phụ thuộc biến toàn cục)
        const listEl = document.getElementById('tsumego-problem-list');
        if (listEl) {
            listEl.addEventListener('click', (e) => {
                const btn = e.target.closest('.problem-item');
                if (btn && btn.dataset.id) this.selectProblem(btn.dataset.id);
            });
        }
    }

    setLevelFilter(level) {
        this.currentLevelFilter = level;
        this.saveSettings({ defaultLevel: level });
        this.syncFilterButtons();
        this.onTabShown(); // Nếu bài đang mở không thuộc nhóm mới thì chuyển sang bài đầu của nhóm
    }

    renderProblemList() {
        const listEl = document.getElementById('tsumego-problem-list');
        if (!listEl) return;

        const filtered = this.getFilteredProblems();

        if (filtered.length === 0) {
            listEl.innerHTML = `<div class="empty-list">Chưa có bài trong nhóm này. Bạn có thể tải thêm file .SGF.</div>`;
            return;
        }

        listEl.innerHTML = filtered.map(p => {
            const isActive = this.currentProblem && this.currentProblem.id === p.id;
            const solved = this.solvedIds.has(p.id);
            return `
                <button type="button" class="problem-item ${isActive ? 'active' : ''} ${solved ? 'solved' : ''}" data-id="${escapeHtml(p.id)}">
                    <span class="problem-name">${escapeHtml(p.title)}</span>
                    <span class="problem-meta">${escapeHtml(p.levelLabel)} ${solved ? '· ✓' : ''}</span>
                </button>
            `;
        }).join('');
    }

    cancelPendingTimer() {
        if (this.pendingTimer) {
            clearTimeout(this.pendingTimer);
            this.pendingTimer = null;
        }
    }

    selectProblem(id) {
        const prob = this.problems.find(item => item.id === id);
        if (!prob) return;

        // Hủy hẹn giờ của bài trước, nếu không nó sẽ ghi đè / đi quân lên bàn cờ của bài mới
        this.cancelPendingTimer();
        this.currentProblem = prob;
        this.isBotThinking = false;

        if (this.board.size !== prob.size) {
            this.board.setSize(prob.size);
        }

        this.board.loadPosition(prob.stones, prob.turn, []);
        this.board.setInteractive(true); // Mở khóa bàn cờ (đã bị khóa sau khi giải xong / đi sai)

        const titleEl = document.getElementById('tsumego-title');
        const badgeEl = document.getElementById('tsumego-level-badge');
        const turnEl = document.getElementById('tsumego-turn');

        if (titleEl) titleEl.textContent = prob.title;
        if (badgeEl) badgeEl.textContent = prob.levelLabel;
        if (turnEl) turnEl.textContent = prob.turn === 1 ? 'Lượt: Đen đi trước' : 'Lượt: Trắng đi trước';

        this.clearFeedback();
        this.renderProblemList();
    }

    resetProblem() {
        if (this.currentProblem) {
            this.selectProblem(this.currentProblem.id);
        }
    }

    showHint() {
        if (!this.currentProblem) return;
        const firstWin = this.currentProblem.winMoves[0];
        if (firstWin) {
            const [hx, hy] = firstWin.split(',').map(Number);
            this.board.markers = [{ x: hx, y: hy, type: 'circle', color: '#16a34a' }];
            this.board.draw();
        }
        this.setFeedback(`Gợi ý: ${this.currentProblem.hintText}`, 'info');
    }

    showSolution() {
        if (!this.currentProblem) return;
        const keys = this.currentProblem.winMoves;
        const labels = 'ABCDEFGH';
        // Các điểm trong winMoves là đáp án thay thế cho nhau (không phải thứ tự nước đi)
        this.board.markers = keys.map((coordStr, idx) => {
            const [x, y] = coordStr.split(',').map(Number);
            return { x, y, type: 'text', text: keys.length === 1 ? '1' : (labels[idx] || String(idx + 1)), color: '#15803d' };
        });
        this.board.draw();
        this.setFeedback(
            keys.length === 1
                ? 'Đã hiển thị điểm lời giải (số 1) trên bàn cờ.'
                : `Bài này có ${keys.length} đáp án đúng. Đi vào bất kỳ điểm đã đánh dấu nào cũng được chấp nhận.`,
            'info'
        );
    }

    handlePlayerMove(move) {
        if (!this.currentProblem || this.isBotThinking) return;

        const problem = this.currentProblem;
        const key = `${move.x},${move.y}`;
        const isCorrect = problem.winMoves.includes(key);

        // Khóa bàn cờ ngay: nước sai thì chờ hoàn tác, nước đúng thì bài đã xong.
        // (Không khóa thì người học vẫn đặt thêm quân được trong lúc chờ.)
        this.board.markers = [];
        this.board.setInteractive(false);

        if (!isCorrect) {
            this.setFeedback('Nước đi này chưa chính xác. Thử lại nhé!', 'error');
            this.cancelPendingTimer();
            this.pendingTimer = setTimeout(() => {
                this.pendingTimer = null;
                this.selectProblem(problem.id);
            }, 700);
            return;
        }

        const explanation = problem.explanations[key] || 'Nước đi chính xác!';
        this.markSolved(problem.id);

        const botReply = problem.replies[key];
        if (botReply) {
            this.isBotThinking = true;
            this.setFeedback(`${explanation} Đối thủ đang đáp trả...`, 'success');
            this.cancelPendingTimer();
            this.pendingTimer = setTimeout(() => {
                this.pendingTimer = null;
                const oppColor = problem.turn === 1 ? 2 : 1;
                // Nước đáp trả do người soạn bài đặt sẵn nên không để luật Ko chặn nhầm
                this.board.koPoint = null;
                this.board.playMove(botReply.x, botReply.y, oppColor);
                this.board.currentPlayer = problem.turn;
                this.isBotThinking = false;
                this.setFeedback(`${explanation} Bạn đã hoàn thành hình cờ này!`, 'success');
            }, 450);
        } else {
            this.setFeedback(`${explanation} Bạn đã hoàn thành bài tập!`, 'success');
        }
    }

    // ---------- Buổi tập hằng ngày ----------

    getDailySessionProblems() {
        const pool = this.getFilteredProblems();
        const source = pool.length > 0 ? pool : this.problems;

        const dayKey = this.todayKey();
        let seed = 0;
        for (let i = 0; i < dayKey.length; i++) {
            seed += dayKey.charCodeAt(i) * (i + 1);
        }

        const rotated = [...source];
        if (rotated.length > 1) {
            const offset = seed % rotated.length;
            for (let i = 0; i < offset; i++) {
                rotated.push(rotated.shift());
            }
        }
        return rotated.slice(0, 3);
    }

    startDailySession() {
        const dailyList = this.getDailySessionProblems();
        if (dailyList.length === 0) return;
        const doneToday = this.loadDailySolved();
        const firstUnsolved = dailyList.find(p => !doneToday.has(p.id)) || dailyList[0];
        this.selectProblem(firstUnsolved.id);
        this.setFeedback(
            `Buổi tập hôm nay (${dailyList.length} bài): Đang mở "${firstUnsolved.title}".`,
            'info'
        );
    }

    syncDailyProgress() {
        const countEl = document.getElementById('daily-count');
        if (countEl) {
            const doneToday = Math.min(3, this.loadDailySolved().size);
            countEl.textContent = `${doneToday}/3`;
        }
    }

    setFeedback(msg, type) {
        const box = document.getElementById('tsumego-feedback');
        if (!box) return;
        box.className = `feedback-box ${type}`;
        box.textContent = msg;
    }

    clearFeedback() {
        const box = document.getElementById('tsumego-feedback');
        if (!box) return;
        box.className = 'feedback-box hidden';
        box.textContent = '';
    }

    // ---------- Nạp bài từ link / thư mục ----------

    // Link trang GitHub (…/blob/…) là trang HTML, không phải file SGF -> đổi sang link raw
    normalizeSGFUrl(url) {
        const m = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i);
        return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : url;
    }

    async importSGFFromUrl(url) {
        const rawUrl = (url || '').trim();
        if (!rawUrl) {
            this.setFeedback('Bạn chưa dán đường dẫn file .sgf.', 'error');
            return;
        }
        const cleanUrl = this.normalizeSGFUrl(rawUrl);

        try {
            this.setFeedback('Đang tải file .sgf...', 'info');
            const res = await fetch(cleanUrl);
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const sgfText = await res.text();
            const fileName = cleanUrl.split('/').pop().split('?')[0] || 'Bai-SGF.sgf';
            this.importSGFText(sgfText, fileName);
        } catch (err) {
            this.setFeedback(`Không tải được SGF từ link này: ${err.message}. Hãy kiểm tra lại link raw hoặc quyền CORS.`, 'error');
        }
    }

    // Nạp nhiều bài SGF từ manifest.json trong thư mục data/sgf (bỏ qua nếu chưa tạo thư mục này)
    async loadLocalSGFManifest(manifestUrl = 'data/sgf/manifest.json') {
        try {
            const res = await fetch(manifestUrl);
            if (!res.ok) return;
            const items = await res.json();
            if (!Array.isArray(items)) return;

            for (const item of items) {
                if (!item || !item.url) continue;
                try {
                    const fileRes = await fetch(item.url);
                    if (!fileRes.ok) continue;
                    const { problem } = this.buildSGFProblem(await fileRes.text(), item.title || item.url);
                    if (!problem) continue;
                    if (item.level) problem.level = item.level;
                    if (item.levelLabel) problem.levelLabel = item.levelLabel;
                    this.insertProblem(problem, true);
                } catch (e) { /* bỏ qua file lỗi, tiếp tục file khác */ }
            }
            this.onTabShown();
        } catch (e) {
            // Bỏ qua nếu chưa tạo thư mục data/sgf
        }
    }
}

let tsumegoApp = null;

// Khởi tạo đúng 1 lần (nhiều bản cùng gắn vào 1 canvas sẽ làm mỗi cú bấm bị xử lý nhiều lần)
function initTsumegoIfNeeded() {
    if (!tsumegoApp && document.getElementById('tsumego-board')) {
        tsumegoApp = new TsumegoModule('tsumego-board');
        // Mở file trực tiếp (file://) thì trình duyệt cấm fetch, chỉ nạp thư mục SGF khi chạy qua server/hosting
        if (location.protocol !== 'file:') tsumegoApp.loadLocalSGFManifest();
    }
}

function startTodaySessionFromMenu() {
    if (typeof switchTab === 'function') {
        switchTab('tsumego');
    } else {
        document.getElementById('home-menu')?.classList.remove('active');
        document.getElementById('tab-tsumego')?.classList.add('active');
    }
    initTsumegoIfNeeded();
    if (tsumegoApp) {
        tsumegoApp.startDailySession();
    }
}