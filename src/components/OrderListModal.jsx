import React, { useState } from 'react';

export default function OrderListModal({ open, onClose, boardName = '', items = [] }) {
  const [copied, setCopied] = useState(false);
  if (!open) return null;

  const handleCopy = () => {
    const text = items.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: '#0008', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 36, minWidth: 340, maxWidth: 420, boxShadow: '0 8px 32px #0003', position: 'relative' }}>
        <h2 style={{ margin: 0, marginBottom: 18, color: '#222', fontWeight: 700, fontSize: 24 }}>ใบสั่งของสำหรับ: {boardName}</h2>
        <div style={{ background: '#f7f7f7', borderRadius: 8, padding: 18, marginBottom: 28, minHeight: 80, fontSize: 17, color: '#222', fontFamily: 'inherit' }}>
          <ul style={{ margin: 0, paddingLeft: 22 }}>
            {items.length === 0 ? (
              <li style={{ color: '#888' }}>ไม่มีรายการ</li>
            ) : (
              items.map((item, idx) => (
                <li key={idx} style={{ marginBottom: 6 }}>{item}</li>
              ))
            )}
          </ul>
        </div>
        <button
          onClick={handleCopy}
          style={{ width: '100%', background: '#222', color: '#fff', fontSize: 20, border: 'none', borderRadius: 8, padding: '16px 0', cursor: 'pointer', fontWeight: 600, marginBottom: 8 }}
        >
          📋 คัดลอกข้อความทั้งหมด
        </button>
        {copied && (
          <div style={{ position: 'absolute', top: 18, right: 24, background: '#222', color: '#fff', borderRadius: 6, padding: '6px 16px', fontSize: 15, fontWeight: 500, zIndex: 10, boxShadow: '0 2px 8px #0002' }}>
            คัดลอกแล้ว!
          </div>
        )}
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', fontSize: 22, color: '#888', cursor: 'pointer' }}
          aria-label="ปิด"
        >
          ×
        </button>
      </div>
    </div>
  );
}
