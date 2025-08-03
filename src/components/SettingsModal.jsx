import React from 'react';

export default function SettingsModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div style={{ position: 'fixed', zIndex: 5000, left: 0, top: 0, width: '100vw', height: '100vh', background: '#0008', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 36, minWidth: 320, maxWidth: 400, boxShadow: '0 8px 32px #0003', position: 'relative' }}>
        <h2 style={{ margin: 0, marginBottom: 18, color: '#222', fontWeight: 700, fontSize: 22 }}>Settings</h2>
        <div style={{ color: '#888', fontSize: 16, marginBottom: 24 }}>
          (Settings options coming soon)
        </div>
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', fontSize: 22, color: '#888', cursor: 'pointer' }}
          aria-label="Close"
        >
          ×
        </button>
      </div>
    </div>
  );
}
