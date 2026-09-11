# ExpenseFlow

Frontend quản lý chi tiêu cá nhân cho **Homework 3A – UI Skeleton**. Giao diện React với dữ liệu mẫu, ngân sách theo tháng và lưu giao dịch trong localStorage. Không có backend hoặc API dữ liệu thật.

## Công nghệ

React, Vite, JavaScript, React Router DOM, Tailwind CSS v4 (Vite plugin), Lucide React, Recharts và ESLint. CSS component tùy chỉnh kết hợp Tailwind; không sử dụng component library. Font hệ thống, không phụ thuộc Google Fonts.

## Cài đặt và chạy

Yêu cầu Node.js 20.19+ hoặc 22.12+ và npm.

```bash
npm install
npm run dev
```

Mở địa chỉ Vite in ra (thường là http://localhost:5173).

```bash
npm run lint
npm run build
npm run preview
```

Định dạng source bằng `npm run format`. Kiểm tra các luồng theo hướng dẫn thủ công bên dưới.

Trên Windows nếu PowerShell chặn `npm.ps1`, sử dụng `npm.cmd` thay cho `npm`. Khi deploy lên static hosting, cấu hình fallback các URL về `index.html` để React Router xử lý truy cập trực tiếp.

## Tính năng

- `/`: lời chào, chọn tháng, bốn thẻ thống kê, biểu đồ cash flow sáu tháng, tỷ trọng chi tiêu và năm giao dịch mới nhất của tháng.
- `/transactions`: bảng desktop/card mobile, tìm theo tên, lọc Income/Expense và danh mục, thêm và xóa giao dịch. Danh sách bao gồm mọi tháng.
- `/budgets`: tổng ngân sách, đã chi, còn lại và năm category cards. `Near limit` từ 80% đến 100%; `Over budget` trên 100%.
- Modal thêm giao dịch: lỗi từng trường, danh mục theo loại, loading ngắn, toast, Escape, overlay, focus trap và trả focus về nút mở.
- Giao dịch thêm/xóa được lưu ngay dưới khóa `expenseflow.transactions.v1`. Mảng rỗng vẫn được giữ sau khi tải lại; không tự chèn lại mock.
- Responsive desktop/tablet/mobile, focus rõ ràng, skip link, reduced motion và nhãn accessibility.

## Kiểm tra bốn UI states

1. **Loading:** mở route Transactions; skeleton xuất hiện khoảng 700 ms. Hoặc nhấn Try again sau lỗi mô phỏng. Khi gửi form hợp lệ, nút lưu hiển thị spinner khoảng 650 ms.
2. **Empty:** tìm một tên không tồn tại, ví dụ `nothingmatches123`. Empty state cung cấp Clear filters. Chọn một tháng không có dữ liệu ở Dashboard để thấy nút Add Transaction.
3. **Success:** thêm giao dịch hợp lệ hoặc bấm biểu tượng thùng rác. Toast xuất hiện ngay, dữ liệu cập nhật không reload. Reload trang để kiểm tra persistence.
4. **Error:** trên Transactions bấm Simulate error. Error card có mô tả và Try again; nhấn để chuyển loading rồi hiện lại dữ liệu. Lỗi mô phỏng không xóa dữ liệu. Lỗi đọc/ghi localStorage có thông báo riêng.

## Kiểm tra thủ công

- Mở form, để trống tên/amount/category/date và submit: lỗi dưới từng trường, focus vào lỗi đầu tiên.
- Nhập amount 0 hoặc âm: từ chối. Chuyển sang Income: chỉ Salary, Freelance, Other Income; category cũ được reset.
- Thêm giao dịch ngày trong tháng đang chọn: xem cập nhật Dashboard, biểu đồ và Budgets nếu thuộc category có ngân sách. Giao dịch ở tháng khác xuất hiện khi chọn tháng tương ứng.
- Xóa giao dịch và reload để kiểm tra localStorage. Muốn về demo ban đầu: xóa khóa `expenseflow.transactions.v1` trong DevTools rồi reload.
- Kiểm tra 375 px, 768 px, 1024 px và desktop rộng; mở menu, sử dụng form và duyệt bằng bàn phím.
- Escape và click bên ngoài đóng form khi không lưu; trong lúc lưu, các thao tác đóng bị khóa để tránh submit dở dang.

## Cấu trúc

```text
src/
  components/
    layout/         # Sidebar và khung trang
    dashboard/      # StatCard và Charts
    transactions/   # TransactionForm và TransactionTable
    budgets/        # BudgetCard
    common/         # Header, month filter, icons, states, toast
  pages/            # Dashboard, Transactions, Budgets
  data/mock.js      # Giao dịch demo, categories, budgets
  hooks/            # Persistence và loading state
  utils/format.js   # Tiền VND, ngày, tháng, phép tính tổng
  App.jsx
  main.jsx
  styles.css
```

## Quy ước và giới hạn

Total Balance là thu nhập trừ chi tiêu **trong tháng đang chọn**, không phải số dư tài khoản ngân hàng. Ngân sách chỉ tính Food, Transportation, Shopping, Entertainment và Education; Rent/Other vẫn nằm trong tổng chi tiêu nhưng không trừ ngân sách của năm danh mục này. Mock có sáu tháng dữ liệu; ngày tháng hiện tại được tạo lúc khởi tạo dữ liệu. Ngân sách là cấu hình mẫu cố định, chưa có chỉnh sửa; xóa giao dịch có hiệu lực ngay. Tài khoản Alex Le là giả, không có đăng nhập, đồng bộ nhiều tab/thiết bị hay bảo mật phía server.
