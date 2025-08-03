import React from 'react';

export default function Header({ onSettingsClick }) {
  return (
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
      <h1 style={{ margin: 0, fontSize: 28 }}>บอร์ดสั่งการของคุณ</h1>
      <button
        aria-label="Settings"
        style={{ fontSize: 24, background: 'none', border: 'none', cursor: 'pointer' }}
        onClick={onSettingsClick}
      >
        ⚙️
      </button>
    </header>
  );
}
