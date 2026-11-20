// Khởi tạo bàn cờ học luật 9x9
const learnBoard = new GoBoardEngine('learn-board', 9, {
    onMove: (moveData) => handleLessonMove(moveData),
    // Nước đi bị từ chối (ô có quân, tự sát, Ko...) -> báo lý do cho người học, không reset bàn
    onInvalid: (reason) => showLessonFeedback(reason, 'error')
});

let currentLessonIndex = 0;
let lessonResetTimer = null; // Hẹn giờ tự hoàn tác nước sai (phải hủy khi đổi bài)
const completedLessons = new Set();

// Dữ liệu 5 bài học cốt lõi cho người mới bắt đầu
const LESSONS = [
    {
        shortTitle: "1. Khí & Đặt quân",
        title: "Bài 1: Quân Cờ & Khí (Liberties)",
        desc: `
            <p>Trong cờ vây, quân cờ không đặt vào ô vuông mà đặt lên <strong>giao điểm</strong> của các đường kẻ.</p>
            <p>Các đường kẻ nối trực tiếp từ một quân cờ ra những giao điểm trống xung quanh được gọi là <strong>Khí</strong> (như những chấm xanh trên bàn cờ).</p>
            <div class="task-box">Nhiệm vụ: Quân Trắng ở giữa đang có 4 khí. Hãy đặt 1 quân Đen vào chấm xanh bất kỳ để giảm khí của Trắng xuống còn 3!</div>
        `,
        setup: () => {
            learnBoard.loadPosition(
                [{ x: 4, y: 4, color: 2 }],
                1,
                [
                    { x: 4, y: 3, type: 'dot', color: '#16a34a' },
                    { x: 4, y: 5, type: 'dot', color: '#16a34a' },
                    { x: 3, y: 4, type: 'dot', color: '#16a34a' },
                    { x: 5, y: 4, type: 'dot', color: '#16a34a' }
                ]
            );
        },
        checkWin: (move) => {
            const validTargets = ['4,3', '4,5', '3,4', '5,4'];
            if (validTargets.includes(`${move.x},${move.y}`)) {
                learnBoard.markers = [];
                learnBoard.draw();
                return { success: true, msg: "Chính xác! Quân Trắng giờ chỉ còn 3 khí. Khi bị bịt hết tất cả khí, quân cờ sẽ bị bắt khỏi bàn." };
            }
            return { success: false, msg: "Hãy thử đặt quân Đen sát cạnh quân Trắng (vào 1 trong 4 chấm xanh) nhé!" };
        }
    },
    {
        shortTitle: "2. Bắt quân (Atari)",
        title: "Bài 2: Bắt Quân Đối Phương",
        desc: `
            <p>Khi một quân (hoặc một đám quân nối liền) chỉ còn <strong>1 khí duy nhất</strong>, trạng thái đó gọi là <em>Atari</em> (báo động).</p>
            <p>Nếu bạn lấp nốt khí cuối cùng đó, toàn bộ đám quân đối phương sẽ bị nhấc khỏi bàn cờ.</p>
            <div class="task-box">Nhiệm vụ: Quân Trắng đang bị bao vây và chỉ còn đúng 1 khí cuối cùng ở chấm xanh. Hãy đặt quân Đen để bắt quân Trắng!</div>
        `,
        setup: () => {
            learnBoard.loadPosition(
                [
                    { x: 4, y: 4, color: 2 },
                    { x: 4, y: 3, color: 1 },
                    { x: 3, y: 4, color: 1 },
                    { x: 5, y: 4, color: 1 }
                ],
                1,
                [{ x: 4, y: 5, type: 'dot', color: '#16a34a' }]
            );
        },
        checkWin: (move) => {
            if (move.captured > 0) {
                learnBoard.markers = [];
                learnBoard.draw();
                return { success: true, msg: "Tuyệt vời! Bạn vừa bắt được 1 quân Trắng. Quân bị bắt sẽ được tính điểm cho bạn vào cuối ván." };
            }
            return { success: false, msg: "Chưa đúng vị trí rồi. Hãy đặt quân vào điểm chấm xanh phía dưới quân Trắng để bịt khí cuối cùng!" };
        }
    },
    {
        shortTitle: "3. Nối quân & Cắt",
        title: "Bài 3: Nối Quân Để Tăng Sức Mạnh",
        desc: `
            <p>Các quân cùng màu đứng cạnh nhau theo đường ngang hoặc dọc sẽ <strong>nối thành một khối thống nhất</strong> và dùng chung khí với nhau.</p>
            <p>Ngược lại, quân đứng chéo nhau không tự động nối mà có thể bị đối phương "cắt" rời.</p>
            <div class="task-box">Nhiệm vụ: Quân Trắng chỉ còn 1 khí! Thay vì để bị bắt, hãy đóng vai Trắng và đặt quân vào chấm xanh để nối với đồng đội bên cạnh.</div>
        `,
        setup: () => {
            learnBoard.loadPosition(
                [
                    { x: 3, y: 4, color: 2 },
                    { x: 5, y: 4, color: 2 },
                    { x: 3, y: 3, color: 1 },
                    { x: 3, y: 5, color: 1 },
                    { x: 2, y: 4, color: 1 }
                ],
                2, // Lượt Trắng
                [{ x: 4, y: 4, type: 'dot', color: '#16a34a' }]
            );
        },
        checkWin: (move) => {
            if (move.x === 4 && move.y === 4) {
                learnBoard.markers = [];
                learnBoard.draw();
                // Tính số khí thật của khối vừa nối thay vì ghi cứng (khối này có 5 khí)
                const libs = learnBoard.getGroupAndLiberties(4, 4).liberties.size;
                return { success: true, msg: `Chuẩn xác! Ba quân Trắng đã nối liền thành một khối vững chắc với tận ${libs} khí.` };
            }
            return { success: false, msg: "Hãy đặt quân Trắng vào điểm giao ở giữa (chấm xanh) để nối 2 quân Trắng lại với nhau." };
        }
    },
    {
        shortTitle: "4. Hai Mắt Bất Tử",
        title: "Bài 4: Quy Tắc Hai Mắt (Sống & Chết)",
        desc: `
            <p>Trong cờ vây, bạn <strong>không được phép tự sát</strong> (đặt quân vào nơi không còn khí, trừ khi nước đó bắt được quân đối phương).</p>
            <p>Vì vậy, nếu một đám quân tạo được <strong>2 khoảng trống tách biệt (gọi là 2 Mắt)</strong>, đối phương không bao giờ có thể bắt được đám quân đó!</p>
            <div class="task-box">Nhiệm vụ: Đám quân Đen đang bị Trắng vây chặt. Hãy đặt 1 quân Đen vào chấm xanh để chia vùng trống thành 2 Mắt riêng biệt!</div>
        `,
        setup: () => {
            const stones = [
                // Đen tạo khung
                {x:2,y:2,color:1}, {x:3,y:2,color:1}, {x:4,y:2,color:1}, {x:5,y:2,color:1}, {x:6,y:2,color:1},
                {x:2,y:3,color:1}, {x:6,y:3,color:1},
                {x:2,y:4,color:1}, {x:3,y:4,color:1}, {x:4,y:4,color:1}, {x:5,y:4,color:1}, {x:6,y:4,color:1},
                // Trắng bao vây bên ngoài
                {x:2,y:1,color:2}, {x:3,y:1,color:2}, {x:4,y:1,color:2}, {x:5,y:1,color:2}, {x:6,y:1,color:2},
                {x:1,y:2,color:2}, {x:1,y:3,color:2}, {x:1,y:4,color:2},
                {x:7,y:2,color:2}, {x:7,y:3,color:2}, {x:7,y:4,color:2},
                {x:2,y:5,color:2}, {x:3,y:5,color:2}, {x:4,y:5,color:2}, {x:5,y:5,color:2}, {x:6,y:5,color:2}
            ];
            learnBoard.loadPosition(stones, 1, [{ x: 4, y: 3, type: 'dot', color: '#16a34a' }]);
        },
        checkWin: (move) => {
            if (move.x === 4 && move.y === 3) {
                learnBoard.markers = [];
                learnBoard.draw();
                return { success: true, msg: "Hoàn hảo! Đám quân Đen giờ đã có 2 Mắt ở hai bên. Trắng không thể đánh vào cả 2 mắt cùng lúc nên Đen sống 100%!" };
            }
            return { success: false, msg: "Hãy đặt quân Đen vào điểm giữa (chấm xanh) để tách khoảng trống thành 2 mắt nhé." };
        }
    },
    {
        shortTitle: "5. Chiếm Đất (Mục tiêu)",
        title: "Bài 5: Mục Tiêu Trò Chơi Là Chiếm Đất",
        desc: `
            <p>Cờ vây không phải trò chơi ăn hết quân đối phương. Mục tiêu cuối cùng là <strong>bao vây được nhiều giao điểm trống (Đất) hơn đối thủ</strong>.</p>
            <p>Ở góc và biên bàn cờ, bạn tốn ít quân hơn để vây đất so với ở giữa bàn cờ.</p>
            <div class="task-box">Nhiệm vụ: Quân Đen đang quây vùng đất góc trên bên trái. Hãy đặt 1 quân Đen vào chấm xanh để khóa chặt cửa ngõ, hoàn thiện khu đất 9 điểm!</div>
        `,
        setup: () => {
            const stones = [
                {x:3,y:0,color:1}, {x:3,y:1,color:1}, {x:3,y:2,color:1},
                {x:0,y:3,color:1}, {x:1,y:3,color:1}, {x:2,y:3,color:1}
            ];
            learnBoard.loadPosition(stones, 1, [{ x: 3, y: 3, type: 'circle', color: '#16a34a' }]);
        },
        checkWin: (move) => {
            if (move.x === 3 && move.y === 3) {
                learnBoard.markers = [];
                learnBoard.draw();
                return { success: true, msg: "Chúc mừng! Bạn đã nắm vững toàn bộ luật chơi cốt lõi của Cờ Vây. Bây giờ bạn đã sẵn sàng luyện bài tập và đấu với AI!" };
            }
            return { success: false, msg: "Hãy đặt quân Đen vào vị trí vòng tròn xanh (D6) để khép kín khu đất góc nhé!" };
        }
    }
];

// Chuyển đổi giữa 4 Tab chính của Website
function switchTab(tabName) {
    const target = document.getElementById(`tab-${tabName}`);
    if (!target) return; // Tên tab không tồn tại: giữ nguyên màn hình hiện tại, không để trắng trang

    document.getElementById('home-menu')?.classList.remove('active');
    document.querySelectorAll('.workspace-section, .tab-section').forEach(sec => {
        sec.classList.remove('active');
    });
    target.classList.add('active');

    if (tabName === 'tsumego' && typeof initTsumegoIfNeeded === 'function') {
        initTsumegoIfNeeded();
        if (tsumegoApp) tsumegoApp.onTabShown();
    }
}
// Render danh sách nút chọn bài học
function renderLessonSteps() {
    const container = document.getElementById('lesson-steps');
    container.innerHTML = LESSONS.map((lesson, idx) => {
        let cls = 'step-pill';
        if (idx === currentLessonIndex) cls += ' active';
        else if (completedLessons.has(idx)) cls += ' completed';
        return `<button class="${cls}" onclick="loadLesson(${idx})">${lesson.shortTitle}</button>`;
    }).join('');
}

// Tải nội dung bài học
function loadLesson(index) {
    // Hủy hẹn giờ hoàn tác của bài trước, nếu không nó sẽ ghi đè bàn cờ của bài mới
    if (lessonResetTimer) {
        clearTimeout(lessonResetTimer);
        lessonResetTimer = null;
    }
    currentLessonIndex = index;
    const lesson = LESSONS[index];

    document.getElementById('lesson-badge').textContent = `Bài ${index + 1} / ${LESSONS.length}`;
    document.getElementById('lesson-title').textContent = lesson.title;
    document.getElementById('lesson-desc').innerHTML = lesson.desc;

    const feedback = document.getElementById('lesson-feedback');
    feedback.className = 'feedback-box hidden';
    feedback.textContent = '';

    lesson.setup();
    learnBoard.setInteractive(true);
    updateBoardStatus();
    renderLessonSteps();
}

// Hiện thông báo trong khung phản hồi của bài học (type: 'success' | 'error')
function showLessonFeedback(msg, type) {
    const feedback = document.getElementById('lesson-feedback');
    feedback.classList.remove('hidden', 'success', 'error');
    feedback.classList.add(type);
    feedback.textContent = msg;
}

function handleLessonMove(moveData) {
    updateBoardStatus();
    const lessonIndex = currentLessonIndex;
    const lesson = LESSONS[lessonIndex];
    const result = lesson.checkWin(moveData);

    showLessonFeedback(result.msg, result.success ? 'success' : 'error');

    // Khóa bàn cờ: sau khi xong bài (hoặc trong lúc chờ hoàn tác) không nhận thêm nước đi,
    // tránh việc bấm thêm làm hỏng kết quả vừa đạt được
    learnBoard.setInteractive(false);

    if (result.success) {
        completedLessons.add(lessonIndex);
        renderLessonSteps();
    } else {
        // Tự động hoàn tác nước đi sai sau 0.8s để người học thử lại
        lessonResetTimer = setTimeout(() => {
            lessonResetTimer = null;
            if (currentLessonIndex !== lessonIndex) return; // Đã chuyển sang bài khác
            lesson.setup();
            learnBoard.setInteractive(true);
            updateBoardStatus();
        }, 800);
    }
}

function updateBoardStatus() {
    const turnText = learnBoard.currentPlayer === 1 ? 'Lượt: Quân Đen' : 'Lượt: Quân Trắng';
    document.getElementById('learn-status').textContent = turnText;
    document.getElementById('black-captures').textContent = learnBoard.captures[1];
    document.getElementById('white-captures').textContent = learnBoard.captures[2];
}

function resetCurrentLesson() {
    loadLesson(currentLessonIndex);
}

function nextLesson() {
    if (currentLessonIndex < LESSONS.length - 1) {
        loadLesson(currentLessonIndex + 1);
    } else {
        switchTab('tsumego');
    }
}

// Khởi chạy bài học đầu tiên khi mở trang
window.addEventListener('DOMContentLoaded', () => {
    loadLesson(0);
    // Khởi tạo module bài tập đúng 1 lần để tiến độ "Buổi tập hôm nay" hiện ngay trên trang chủ
    if (typeof initTsumegoIfNeeded === 'function') initTsumegoIfNeeded();
});

