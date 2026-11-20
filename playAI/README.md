# KataGo trên trình duyệt

Chạy ứng dụng qua Vite để đóng gói engine và Web Worker:

```powershell
npm install
npm run dev
```

Mở trang `/playAI/playai.html`. Engine dùng `katago/kata.bin` (~282 MB) và chạy cục bộ bằng backend WASM để tránh lỗi WebGPU/compilation shader trên một số trình duyệt hoặc driver đồ họa. Không mở trang trực tiếp bằng `file://`.

Sau mỗi nước đi của người chơi, KataGo phân tích vị trí trước nước đó và hiển thị một nước thay thế bằng dấu mờ trên bàn cờ, kèm xếp loại nước vừa đi theo win rate ước tính và giải thích về bắt quân, nối nhóm và khí. Nước gợi ý chỉ để tham khảo và không làm thay đổi ván đấu. Nếu người chơi cầm Trắng, máy sẽ đi trước bằng Đen; nút bỏ lượt chỉ có tác dụng trong lượt của người chơi.
