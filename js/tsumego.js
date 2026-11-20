/**
 * TsumegoModule - Luyện sống chết & hình cờ
 * Hỗ trợ bài mẫu theo cấp độ + đọc file .SGF + buổi tập hằng ngày + cài đặt giao diện
 */
class TsumegoModule {
    constructor(canvasId) {
        this.board = new GoBoardEngine(canvasId, 9, {
            interactive: true,
            onMove: (move) => this.handlePlayerMove(move)
        });

        const settings = this.getSettings();
        this.currentLevelFilter = settings.defaultLevel || 'all';
        this.problems = this.getDefaultProblems();
        this.currentProblem = null;
        this.isBotThinking = false;
        // Dữ liệu lưu cũ có thể bị hỏng hoặc localStorage bị trình duyệt chặn.
        try {
            const savedSolvedIds = JSON.parse(localStorage.getItem('cvdgl_solved_tsumego') || '[]');
            this.solvedIds = new Set(Array.isArray(savedSolvedIds) ? savedSolvedIds : []);
        } catch (error) {
            this.solvedIds = new Set();
        }

        this.bindEvents();
        this.applySettings(settings);
        this.syncFilterButtons();
        this.renderProblemList();

        if (this.problems.length > 0) {
            this.selectProblem(this.problems[0].id);
        }
        this.syncDailyProgress();
    }

    getSettings() {
        try {
            return JSON.parse(localStorage.getItem('cvdgl_tsumego_settings')) || {
                theme: 'kaya',
                defaultLevel: 'all'
            };
        } catch (e) {
            return { theme: 'kaya', defaultLevel: 'all' };
        }
    }

    saveSettings(partial = {}) {
        const next = { ...this.getSettings(), ...partial };
        try {
            localStorage.setItem('cvdgl_tsumego_settings', JSON.stringify(next));
        } catch (error) {
            // Vẫn áp dụng cài đặt trong phiên hiện tại nếu không thể lưu.
        }
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
    }

    syncFilterButtons() {
        document.querySelectorAll('.tsumego-filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.level === this.currentLevelFilter);
        });
    }

    sgfCoordToXY(coord) {
        if (!coord || coord.length < 2) return null;
        const x = coord.charCodeAt(0) - 97;
        const y = coord.charCodeAt(1) - 97;
        return { x, y };
    }

    parseSGF(sgfText, fileName = 'Bài SGF') {
        const clean = sgfText.replace(/\r?\n/g, '');
        const szMatch = clean.match(/SZ\[(\d+)\]/);
        const size = szMatch ? parseInt(szMatch[1], 10) : 9;

        const stones = [];
        const addColor = (tag, color) => {
            const regex = new RegExp(`${tag}(\\[[a-s]{2}\\])+`, 'g');
            const blockMatch = clean.match(regex);
            if (!blockMatch) return;
            const coords = [...blockMatch[0].matchAll(/\[([a-s]{2})\]/g)];
            coords.forEach(m => {
                const pt = this.sgfCoordToXY(m[1]);
                if (pt) stones.push({ x: pt.x, y: pt.y, color });
            });
        };

        addColor('AB', 1);
        addColor('AW', 2);

        const plMatch = clean.match(/PL\[(B|W)\]/);
        const turn = plMatch && plMatch[1] === 'W' ? 2 : 1;

        const moveMatches = [...clean.matchAll(/;(B|W)\[([a-s]{2})\](?:N\[([^\]]*)\]|C\[([^\]]*)\])?/g)];
        const replies = {};
        const winMoves = [];
        const explanations = {};

        for (let i = 0; i < moveMatches.length; i++) {
            const [, who, coord, , comment] = moveMatches[i];
            const pt = this.sgfCoordToXY(coord);
            if (!pt) continue;
            const key = `${pt.x},${pt.y}`;
            const moverColor = who === 'B' ? 1 : 2;

            if (moverColor === turn) {
                winMoves.push(key);
                if (comment) explanations[key] = comment;

                if (i + 1 < moveMatches.length) {
                    const next = moveMatches[i + 1];
                    const nextColor = next[1] === 'B' ? 1 : 2;
                    const nextPt = this.sgfCoordToXY(next[2]);
                    if (nextColor !== turn && nextPt) {
                        replies[key] = nextPt;
                    }
                }
            }
        }

        const titleMatch = clean.match(/GN\[([^\]]+)\]/);
        return {
            id: 'sgf-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
            title: titleMatch ? titleMatch[1] : fileName.replace(/\.sgf$/i, ''),
            level: 'sgf',
            levelLabel: 'File SGF',
            size,
            turn,
            hintText: 'Tìm điểm then chốt cắt khí hoặc nối quân tạo 2 mắt.',
            stones,
            winMoves,
            replies,
            explanations
        };
    }

    getDefaultProblems() {
        const make = (id,title,level,label,turn,stones,sequence,hintText,description) => ({
            id,title,level,levelLabel:label,size:9,turn,stones,sequence,hintText,description,
            winMoves:sequence.map(s=>s.move),replies:{},
            explanations:Object.fromEntries(sequence.map(s=>[s.move,s.explanation]))
        });
        return [
            make('begin-01','Bịt khí ở cạnh bàn','30k-20k','30k – 20k',1,
                [{x:1,y:1,color:2},{x:0,y:1,color:1},{x:2,y:1,color:1}],
                [{move:'1,0',reply:null,explanation:'Đen lấp khí cuối cùng và bắt quân Trắng.'}],
                'Quân Trắng sát góc chỉ còn một khí.','Bài một nước: nhận biết khí cuối cùng.'),
            make('begin-02','Nối hai quân Đen','30k-20k','30k – 20k',1,
                [{x:2,y:4,color:1},{x:4,y:4,color:1},{x:3,y:3,color:2}],
                [{move:'3,4',reply:{x:3,y:5},explanation:'Đen nối thành một nhóm. Máy áp sát từ phía dưới.'},
                 {move:'2,5',reply:null,explanation:'Nước thứ hai giúp nhóm Đen mở rộng khí và giữ liên kết.'}],
                'Tìm điểm nối trực tiếp giữa hai quân Đen.','Hai lượt người học, xen giữa là nước đáp trả của máy.'),
            make('begin-03','Bắt quân trong góc','30k-20k','30k – 20k',1,
                [{x:0,y:0,color:2},{x:1,y:0,color:1},{x:0,y:1,color:1},{x:2,y:1,color:2}],
                [{move:'1,1',reply:{x:2,y:0},explanation:'Đen mở rộng thế bắt. Máy đặt quân chống đỡ.'},
                 {move:'0,2',reply:null,explanation:'Đen tiếp tục khóa đường thoát ở cạnh.'}],
                'Khóa đường chạy trước khi bắt quân.','Tập đọc đường thoát của nhóm quân ở góc.'),
            make('begin-04','Giữ khí cho nhóm quân','30k-20k','30k – 20k',1,
                [{x:3,y:3,color:1},{x:4,y:3,color:2},{x:3,y:4,color:2}],
                [{move:'2,3',reply:{x:5,y:3},explanation:'Đen mở thêm một hướng thoát. Máy áp sát nhóm.'},
                 {move:'2,4',reply:null,explanation:'Bạn đã nối rộng nhóm và tạo thêm khí.'}],
                'Chọn điểm giúp nhóm Đen có thêm khí.','Thực hành tăng khí bằng cách nối quân.'),
            make('mid-01','Tạo mắt trong vùng đất','19k-10k','19k – 10k',1,
                [{x:2,y:2,color:1},{x:3,y:2,color:1},{x:2,y:3,color:1},{x:4,y:2,color:2}],
                [{move:'3,3',reply:{x:4,y:3},explanation:'Đen chiếm điểm then chốt. Máy thử xâm nhập.'},
                 {move:'2,4',reply:null,explanation:'Đen củng cố vùng đất và giữ khoảng trống làm mắt.'}],
                'Điểm then chốt nằm sát nhóm Đen.','Bài hai nước: chiếm điểm sống còn rồi củng cố.'),
            make('mid-02','Chặn đường chạy của quân Trắng','19k-10k','19k – 10k',1,
                [{x:4,y:2,color:2},{x:3,y:2,color:1},{x:5,y:2,color:1},{x:4,y:3,color:2}],
                [{move:'3,3',reply:{x:5,y:3},explanation:'Đen chặn một hướng thoát. Máy tìm đường phía còn lại.'},
                 {move:'4,4',reply:null,explanation:'Nước thứ hai khóa đường chạy còn lại.'}],
                'Tính trước hai hướng chạy của quân Trắng.','Tập đọc đường chạy và chặn theo thứ tự.'),
            make('mid-03','Nối nhóm trước khi bị cắt','19k-10k','19k – 10k',2,
                [{x:2,y:4,color:2},{x:4,y:4,color:2},{x:3,y:3,color:1}],
                [{move:'3,4',reply:{x:3,y:5},explanation:'Trắng nối hai nhóm. Máy thử cắt từ phía dưới.'},
                 {move:'2,5',reply:null,explanation:'Trắng gia cố liên kết và giữ nhóm an toàn.'}],
                'Bạn cầm Trắng. Hãy nối hai nhóm trước khi Đen cắt.','Bài hai nước dành cho bên Trắng.'),
            make('mid-04','Đánh vào điểm yếu','19k-10k','19k – 10k',1,
                [{x:3,y:3,color:2},{x:4,y:3,color:2},{x:5,y:4,color:1},{x:4,y:5,color:1}],
                [{move:'4,4',reply:{x:3,y:4},explanation:'Đen đánh vào điểm yếu giữa hai quân Trắng. Máy tìm cách nối.'},
                 {move:'5,3',reply:null,explanation:'Nước thứ hai tiếp tục tách nhóm Trắng và tạo áp lực.'}],
                'Tìm điểm cắt khiến hai quân Trắng khó hỗ trợ nhau.','Tập chiến thuật cắt và gây áp lực.'),
            make('adv-01','Đọc trước ba nước khi tấn công','9k-1d','9k – 1d',1,
                [{x:3,y:3,color:2},{x:4,y:3,color:2},{x:5,y:3,color:2},{x:3,y:4,color:1},{x:5,y:4,color:1}],
                [{move:'4,4',reply:{x:4,y:5},explanation:'Nước đầu tiên ép nhóm Trắng xuống. Máy đáp trả.'},
                 {move:'3,5',reply:{x:5,y:5},explanation:'Đen khóa cánh trái; máy tìm cách mở cánh phải.'},
                 {move:'4,6',reply:null,explanation:'Đen khép vùng vây và duy trì áp lực.'}],
                'Tính hướng chạy sau mỗi lần đối thủ đáp trả.','Bài ba nước: tấn công theo hướng và giữ thế vây.'),
            make('adv-02','Cắt và ép nhóm quân','9k-1d','9k – 1d',1,
                [{x:2,y:3,color:2},{x:3,y:3,color:2},{x:5,y:3,color:2},{x:4,y:2,color:1},{x:4,y:4,color:1}],
                [{move:'4,3',reply:{x:3,y:4},explanation:'Đen cắt đôi hình cờ. Máy nối về phía trái.'},
                 {move:'5,4',reply:{x:6,y:3},explanation:'Đen gây sức ép lên nhóm bên phải. Máy tìm đường thoát.'},
                 {move:'6,4',reply:null,explanation:'Nước thứ ba khóa hướng chạy và hoàn tất chuỗi chiến thuật.'}],
                'Tìm nước cắt trước, sau đó ép nhóm yếu chạy về phía bất lợi.','Bài ba nước: cắt, đuổi và khóa đường chạy.'),
            make('adv-03','Tạo mắt giả rồi phá thế','9k-1d','9k – 1d',2,
                [{x:2,y:2,color:1},{x:3,y:2,color:1},{x:4,y:2,color:1},{x:2,y:3,color:1},{x:4,y:3,color:1},{x:3,y:4,color:2}],
                [{move:'3,3',reply:{x:1,y:3},explanation:'Trắng chiếm điểm then chốt trong hình. Máy mở rộng biên.'},
                 {move:'2,4',reply:{x:4,y:4},explanation:'Trắng giữ liên kết và thu hẹp mắt giả. Máy chống đỡ.'},
                 {move:'3,5',reply:null,explanation:'Trắng đọc đủ chuỗi nước để phá thế phòng thủ.'}],
                'Bạn cầm Trắng. Chiếm điểm then chốt rồi thu hẹp không gian sống.','Bài ba nước dành cho người chơi muốn đọc sâu.'),
            make('adv-04','Vây bắt bằng thứ tự chính xác','9k-1d','9k – 1d',1,
                [{x:3,y:2,color:2},{x:4,y:2,color:2},{x:5,y:2,color:2},{x:3,y:3,color:1},{x:5,y:3,color:1},{x:4,y:4,color:2}],
                [{move:'4,3',reply:{x:2,y:3},explanation:'Đen đặt nước chặn đầu. Máy thử mở đường cánh trái.'},
                 {move:'6,3',reply:{x:6,y:2},explanation:'Đen khép cánh phải. Máy tìm cách thoát lên trên.'},
                 {move:'6,4',reply:null,explanation:'Nước cuối khóa đường thoát và hoàn tất thế vây.'}],
                'Tính đường chạy của nhóm Trắng và chặn các cửa theo đúng thứ tự.','Bài ba nước: đọc hướng chạy trước khi vây bắt.')
        ];
    }

    bindEvents() {
        const fileInput = document.getElementById('sgf-file-input');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const parsed = this.parseSGF(ev.target.result, file.name);
                    this.problems.unshift(parsed);
                    this.currentLevelFilter = 'all';
                    this.syncFilterButtons();
                    this.renderProblemList();
                    this.selectProblem(parsed.id);
                    this.setFeedback(`Đã nạp bài tập từ file "${file.name}".`, 'success');
                };
                reader.readAsText(file);
                e.target.value = '';
            });
        }
    }

    setLevelFilter(level, btnEl) {
        this.currentLevelFilter = level;
        this.saveSettings({ defaultLevel: level });
        document.querySelectorAll('.tsumego-filter-btn').forEach(b => b.classList.remove('active'));
        if (btnEl) btnEl.classList.add('active');
        else this.syncFilterButtons();
        this.renderProblemList();
    }

    renderProblemList() {
        const listEl = document.getElementById('tsumego-problem-list');
        if (!listEl) return;

        const filtered = this.currentLevelFilter === 'all'
            ? this.problems
            : this.problems.filter(p => p.level === this.currentLevelFilter);

        if (filtered.length === 0) {
            listEl.innerHTML = `<div class="empty-list">Chưa có bài trong nhóm này. Bạn có thể tải thêm file .SGF.</div>`;
            return;
        }

        listEl.innerHTML = filtered.map(p => {
            const activeCls = this.currentProblem && this.currentProblem.id === p.id ? 'active' : '';
            const solvedCls = this.solvedIds.has(p.id) ? 'solved' : '';
            return `
                <button class="problem-item ${activeCls} ${solvedCls}" onclick="tsumegoApp && tsumegoApp.selectProblem('${p.id}')">
                    <span class="problem-name">${p.title}</span>
                    <span class="problem-meta">${p.levelLabel} ${this.solvedIds.has(p.id) ? '· ✓' : ''}</span>
                </button>
            `;
        }).join('');
    }

    selectProblem(id) {
        const prob = this.problems.find(item => item.id === id);
        if (!prob) return;
        this.currentProblem = prob;
        this.currentStepIndex = 0;
        this.isBotThinking = false;

        if (this.board.size !== prob.size) {
            this.board.setSize(prob.size);
        }

        this.board.loadPosition(prob.stones, prob.turn, []);
        const titleEl = document.getElementById('tsumego-title');
        const badgeEl = document.getElementById('tsumego-level-badge');
        const turnEl = document.getElementById('tsumego-turn');

        if (titleEl) titleEl.textContent = prob.title;
        if (badgeEl) badgeEl.textContent = prob.levelLabel;
        if (turnEl) turnEl.textContent = prob.turn === 1 ? 'Lượt: Đen đi trước' : 'Lượt: Trắng đi trước';

        this.clearFeedback();
        this.renderProblemList();
        if (prob.description) this.setFeedback(prob.description, 'info');
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
        const markers = this.currentProblem.winMoves.map((coordStr, idx) => {
            const [x, y] = coordStr.split(',').map(Number);
            return { x, y, type: 'text', text: String(idx + 1), color: '#15803d' };
        });
        this.board.markers = markers;
        this.board.draw();
        this.setFeedback('Đã hiển thị các điểm lời giải chính trên bàn cờ.', 'info');
    }

    handlePlayerMove(move) {
        if (!this.currentProblem || this.isBotThinking) return;
        if (!Array.isArray(this.currentProblem.sequence)) {
            this.currentProblem.sequence = (this.currentProblem.winMoves || []).map(key => ({
                move:key, reply:this.currentProblem.replies?.[key] || null,
                explanation:this.currentProblem.explanations?.[key] || 'Nước đi chính xác!'
            }));
        }
        if (this.currentStepIndex == null) this.currentStepIndex = 0;
        const step = this.currentProblem.sequence[this.currentStepIndex];
        const key = `${move.x},${move.y}`;
        if (!step || key !== step.move) {
            this.setFeedback('Nước đi chưa đúng ở bước này. Hãy thử lại nhé!', 'error');
            this.isBotThinking = true;
            setTimeout(() => {
                this.isBotThinking = false;
                this.selectProblem(this.currentProblem.id);
            }, 800);
            return;
        }
        this.board.markers = [];
        this.board.draw();
        const explanation = step.explanation || 'Nước đi chính xác!';
        const nextIndex = this.currentStepIndex + 1;
        const advance = () => {
            this.currentStepIndex = nextIndex;
            if (nextIndex >= this.currentProblem.sequence.length) {
                this.solvedIds.add(this.currentProblem.id);
                try { localStorage.setItem('cvdgl_solved_tsumego', JSON.stringify([...this.solvedIds])); } catch (e) {}
                this.syncDailyProgress();
                this.renderProblemList();
                this.setFeedback(`${explanation} Hoàn thành toàn bộ ${this.currentProblem.sequence.length} nước!`, 'success');
            } else {
                this.setFeedback(`${explanation} Đến lượt bạn tìm nước thứ ${nextIndex + 1}/${this.currentProblem.sequence.length}.`, 'info');
            }
        };
        if (step.reply) {
            this.isBotThinking = true;
            this.setFeedback(`${explanation} Máy đang đáp trả...`, 'success');
            setTimeout(() => {
                const opponent = this.currentProblem.turn === 1 ? 2 : 1;
                const result = this.board.playMove(step.reply.x, step.reply.y, opponent);
                if (!result.valid) {
                    this.isBotThinking = false;
                    this.setFeedback('Nước đáp trả của máy trong dữ liệu bài tập không hợp lệ. Cần hiệu chỉnh bài này.', 'error');
                    return;
                }
                this.board.currentPlayer = this.currentProblem.turn;
                this.isBotThinking = false;
                advance();
            }, 500);
        } else {
            advance();
        }
    }

    getDailySessionProblems() {
        const pool = this.currentLevelFilter === 'all'
            ? this.problems
            : this.problems.filter(p => p.level === this.currentLevelFilter);
        const source = pool.length > 0 ? pool : this.problems;

        const dayKey = new Date().toISOString().slice(0, 10);
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
        const firstUnsolved = dailyList.find(p => !this.solvedIds.has(p.id)) || dailyList[0];
        this.selectProblem(firstUnsolved.id);
        this.setFeedback(
            `Buổi tập hôm nay (${dailyList.length} bài): Đang mở "${firstUnsolved.title}".`,
            'info'
        );
    }

    syncDailyProgress() {
        const countEl = document.getElementById('daily-count');
        if (countEl) {
            const doneToday = Math.min(3, this.solvedIds.size);
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

    async importSGFFromUrl(url) {
    const cleanUrl = (url || '').trim();
    if (!cleanUrl) {
        this.setFeedback('Bạn chưa dán đường dẫn file .sgf.', 'error');
        return;
    }

    try {
        this.setFeedback('Đang tải file .sgf...', 'info');
        const res = await fetch(cleanUrl);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const sgfText = await res.text();
        const fileName = cleanUrl.split('/').pop() || 'Bai-SGF.sgf';
        const parsed = this.parseSGF(sgfText, fileName);

        if (!parsed.stones || parsed.stones.length === 0) {
            this.setFeedback('File tải về không có hình cờ hợp lệ (thiếu AB/AW).', 'error');
            return;
        }

        this.problems.unshift(parsed);
        this.currentLevelFilter = 'all';
        this.syncFilterButtons();
        this.renderProblemList();
        this.selectProblem(parsed.id);
        this.setFeedback(`Đã thêm bài "${parsed.title}" thành công!`, 'success');
    } catch (err) {
        this.setFeedback(`Không tải được SGF từ link này: ${err.message}. Hãy kiểm tra lại link raw hoặc quyền CORS.`, 'error');
    }
}

// load file manifest.json để nạp nhiều bài SGF từ thư mục data/sgf
async loadLocalSGFManifest(manifestUrl = 'data/sgf/manifest.json') {
    try {
        const res = await fetch(manifestUrl);
        if (!res.ok) return;
        const items = await res.json();
        if (!Array.isArray(items)) return;

        for (const item of items) {
            if (!item.url) continue;
            const fileRes = await fetch(item.url);
            if (!fileRes.ok) continue;
            const sgfText = await fileRes.text();
            const parsed = this.parseSGF(sgfText, item.title || item.url);
            if (item.level) parsed.level = item.level;
            if (item.levelLabel) parsed.levelLabel = item.levelLabel;
            this.problems.push(parsed);
        }
        this.renderProblemList();
    } catch (e) {
        // Bỏ qua nếu chưa tạo thư mục data/sgf
    }
}
}

let tsumegoApp = null;

function initTsumegoIfNeeded() {
    if (!tsumegoApp && document.getElementById('tsumego-board')) {
        tsumegoApp = new TsumegoModule('tsumego-board');
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