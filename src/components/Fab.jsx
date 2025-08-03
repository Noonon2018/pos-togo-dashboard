import React from 'react';

export default function Fab({ onClick }) {
  return (
    <button
      onClick={onClick}
      aria-label="เพิ่มการ์ดใหม่"
      style={{
        position: 'fixed',
        right: 24,
        bottom: 24,
        width: 64,
        height: 64,
        borderRadius: '50%',
        background: '#1976d2',
        color: '#fff',
        fontSize: 36,
        border: 'none',
        boxShadow: '0 4px 16px #0003',
        cursor: 'pointer',
        zIndex: 1000
      }}
    >
      +
    </button>
  );
}
