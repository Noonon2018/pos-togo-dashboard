import React from 'react';

export default function SearchBar({ value, onChange }) {
  return (
    <div style={{ padding: 16, borderBottom: '1px solid #eee', background: '#fafafa' }}>
      <input
        type="text"
        placeholder="ค้นหารายการ หรือ #แท็ก"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width: '100%', padding: 12, fontSize: 16, borderRadius: 8, border: '1px solid #ccc' }}
      />
    </div>
  );
}
