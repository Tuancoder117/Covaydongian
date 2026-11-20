# KataGo trên trình duyệt

Chạy ứng dụng qua Vite để đóng gói engine và Web Worker:

```powershell
npm install
npm run dev
```

Mở trang `/playAI/playai.html`. Engine dùng `katago/kata.bin` (~282 MB) và chạy cục bộ; WebGPU được chọn khi trình duyệt hỗ trợ, nếu không sẽ dùng WASM. Không mở trang trực tiếp bằng `file://`.
