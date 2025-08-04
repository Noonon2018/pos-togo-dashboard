

# POS TOGO Dashboard (บอร์ดสั่งการ/OrderPad สองภาษา)

เว็บแอป React + Vite สำหรับจัดการออเดอร์และบอร์ด รองรับภาษาไทยและอังกฤษ (Bilingual)

## ฟีเจอร์หลัก
- หน้าแรกเป็น OrderPad: แสดงรายการออเดอร์แบบ Draft และ History (ส่งแล้ว)
- เพิ่ม/แก้ไข/ลบออเดอร์ (NewOrder)
- ดูรายละเอียดออเดอร์ (OrderDetailModal)
- ระบบบันทึกข้อมูลออเดอร์ใน localStorage (ไม่ต้องมี backend)
- ระบบ autocomplete รายการสินค้าและซัพพลายเออร์
- แนบรูปภาพสินค้าในออเดอร์ได้
- คัดลอกข้อความออเดอร์, สั่งพิมพ์, บันทึก draft, ส่งออเดอร์
- Responsive UI, ใช้งานได้ทั้งมือถือและเดสก์ท็อป
- เตรียมโครงสร้างรองรับ i18n (ไทย/อังกฤษ)

## วิธีเริ่มต้นใช้งาน
1. ติดตั้ง dependencies:
   ```sh
   npm install
   ```
2. รันเซิร์ฟเวอร์สำหรับพัฒนา:
   ```sh
   npm run dev
   ```
3. เปิดเบราว์เซอร์ที่ URL ที่แสดงในเทอร์มินัล (ปกติ http://localhost:5173 หรือ 5174)

## โครงสร้างไฟล์หลัก
- `src/App.jsx` จุดเริ่มต้นของแอปและควบคุมการเปลี่ยนหน้า (OrderPad/NewOrder)
- `src/OrderPad.jsx` หน้าแสดงรายการออเดอร์ (Draft/History)
- `src/NewOrder.jsx` หน้าเพิ่ม/แก้ไขออเดอร์
- `src/components/OrderDetailModal.jsx` ดูรายละเอียดออเดอร์
- `src/components/Header.jsx`, `BoardList.jsx`, `SettingsModal.jsx` ฯลฯ สำหรับ Dashboard

---
สร้างด้วย React + Vite | Responsive | i18n-ready | LocalStorage only
