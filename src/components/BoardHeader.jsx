import React from 'react';

export default function BoardHeader({ boardName, onBack, onCreateOrder }) {
  return (
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottom: '1px solid #eee' }}>
      <button onClick={onBack} style={{ fontSize: 20, background: 'none', border: 'none', cursor: 'pointer', color: '#111' }}>&lt; กลับ</button>
      <h2 style={{ margin: 0, fontSize: 28 }}>{boardName}</h2>
      <button onClick={onCreateOrder} style={{ fontSize: 20, background: '#ffd600', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', color: '#111' }}>
        ✨ สร้างใบสั่งของ
      </button>
    </header>
  );
}
