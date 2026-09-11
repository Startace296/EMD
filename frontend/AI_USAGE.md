# Record AI-generated code and human review

## Công cụ AI

**Codex** hỗ trợ triển khai frontend trong workspace này.

## Prompt dùng để tạo giao diện

Yêu cầu của người dùng (tóm lược giữ nguyên phạm vi): “Bạn là một Senior Frontend Developer. Hãy xây dựng hoàn chỉnh frontend cho một ứng dụng quản lý chi tiêu cá nhân bằng React, đáp ứng Homework 3A – UI Skeleton. Tên ExpenseFlow, React + Vite + React Router DOM + Tailwind CSS + Lucide React + Recharts, JavaScript, mock data và localStorage. Ba route Dashboard, Transactions, Budgets; modal thêm giao dịch có validation, loading, success toast; danh sách tìm/lọc/xóa; skeleton, empty state và Simulate error/Try again; responsive 375/768/1024+, accessibility, source code chia component; tạo README và AI_USAGE; cài dependencies, lint, build và kiểm tra thực tế.”

Prompt đầy đủ nằm trong hội thoại tác vụ gốc, gồm 13 phần yêu cầu chi tiết do người dùng cung cấp.

## Phần được AI hỗ trợ

- Khởi tạo project và cấu hình Vite, React, Tailwind, ESLint.
- Thiết kế giao diện emerald, layout, sidebar mobile và ba trang.
- Component thống kê, biểu đồ, bảng/card giao dịch, ngân sách và UI states.
- Form validation, focus trap, loading, toast và lưu trữ localStorage.
- Mock data, utilities, tài liệu và kiểm tra tự động trong môi trường thực thi.

## Người phát triển cần review thủ công

- Chất lượng giao diện trên thiết bị thật, Safari và trình duyệt mục tiêu.
- Thứ tự focus, độ tương phản, thông báo với screen reader, bàn phím trên mobile.
- Quy ước số dư theo tháng, giới hạn ngân sách và dữ liệu demo có phù hợp bài tập.
- Nội dung tiếng Anh, tên tài khoản và màu cảnh báo.
- Thêm/xóa dữ liệu, localStorage trong private mode hoặc bị chặn, và refresh route trên hosting.
- Kiểm tra số tiền rất lớn, tên dài và ngày ở quá khứ/tương lai.

## Quyết định và thay đổi sau human review

**Chưa có human review được ghi nhận.** Các lựa chọn hiện tại do Codex thực hiện theo yêu cầu; không phải quyết định đã được con người phê duyệt.

| Người review | Ngày | Hạng mục | Quyết định/thay đổi         |
| ------------ | ---- | -------- | --------------------------- |
| Chưa điền    | —    | —        | Điền sau khi review thực tế |

## Checklist xác nhận của người review

- [ ] Responsive tại 375 px, 768 px và desktop từ 1024 px.
- [ ] Form validation và danh mục theo Income/Expense đúng.
- [ ] Loading: skeleton và spinner khi submit.
- [ ] Empty: tìm kiếm rỗng và Clear filters/Add Transaction.
- [ ] Success: thêm/xóa cập nhật dữ liệu và toast.
- [ ] Error: Simulate error → Try again → loading → success.
- [ ] localStorage giữ dữ liệu sau reload.
- [ ] Accessibility: labels, focus, Escape và keyboard navigation.
- [ ] `npm run lint` thành công.
- [ ] `npm run build` thành công.

Checklist này dành cho con người, chưa tự đánh dấu chỉ dựa trên kiểm tra của AI. Kết quả kiểm tra do Codex chạy được ghi riêng trong báo cáo bàn giao.

## Kết quả kiểm tra do Codex thực hiện

- `npm run lint`: đạt, 0 lỗi và 0 cảnh báo.
- `npm run build`: đạt; output trong `dist/`, chia chunk cho biểu đồ.
- Trước khi gỡ bộ test theo yêu cầu người dùng, 3/3 bài kiểm tra Playwright đã đạt trên Chrome. Project hiện không còn lệnh `npm test`.
- Đã kiểm tra loading, empty, success và error/retry; validation tên, số tiền âm/rỗng, loại, danh mục, ngày; thêm/xóa và persistence sau reload.
- Đã kiểm tra thay đổi số liệu Dashboard và Food budget khi thêm expense; localStorage rỗng không tự reset thành demo.
- Ba route được mở ở 375, 768, 1024 và 1440 px, không phát hiện horizontal overflow. Ảnh trong `artifacts/` đã được kiểm tra trực quan cho Dashboard desktop/mobile, Transactions mobile và Budgets mobile.
- Đã kiểm tra focus ban đầu, vòng Tab trong modal, Escape và trả focus về nút mở. Lỗi trả focus trong React Strict Mode phát hiện khi test đã được sửa.
- Chưa kiểm tra trên thiết bị vật lý, Safari hoặc screen reader thực tế; cần human review cho các mục này.
