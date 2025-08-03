import React, { useState } from 'react';

const modalStyle = {
  position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: '#0008', zIndex: 2000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const boxStyle = {
  background: '#fff', borderRadius: 12, padding: 32, minWidth: 340, maxWidth: 400, boxShadow: '0 8px 32px #0003',
};

export default function CardModal({ open, onClose, onSave, initial, tagsList = [] }) {
  // Removed th, setTh (Thai field) for English-only version
  const [en, setEn] = useState(initial?.en || '');
  const [tags, setTags] = useState(initial?.tags || []);
  const [tagInput, setTagInput] = useState('');
  // Removed loading, setLoading (no translate button)

  if (!open) return null;

  // Removed handleTranslate (no translate button)

  const handleAddTag = (tag) => {
    if (tag && !tags.includes(tag)) setTags([...tags, tag]);
    setTagInput('');
  };

  const handleRemoveTag = (tag) => setTags(tags.filter(t => t !== tag));

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({ en, tags });
  };

  return (
    <div style={modalStyle}>
      <div style={boxStyle}>
        <h3 style={{ marginTop: 0, color: '#222' }}>{initial ? 'Edit item' : 'Add new item'}</h3>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ color: '#222', fontWeight: 700 }}>For you</label>
            <textarea value={en} onChange={e => setEn(e.target.value)} rows={2} style={{ width: '100%', fontSize: 16, marginTop: 4, color: '#222', background: '#f7f7f7' }} placeholder="Enter item details" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ color: '#222', fontWeight: 700 }}>Tags</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <input
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => (e.key === 'Enter' && (e.preventDefault(), handleAddTag(tagInput.trim())))}
                placeholder="Add new tag"
                style={{ flex: 1, fontSize: 15, color: '#1a1a1a', background: '#f7f7f7', border: '1px solid #bbb', borderRadius: 6, padding: '6px 10px' }}
              />
              <button type="button" onClick={() => handleAddTag(tagInput.trim())} style={{ fontSize: 16, color: '#fff', background: '#1976d2', border: 'none', borderRadius: 6, padding: '6px 16px', cursor: 'pointer' }}>Add</button>
            </div>
            <div style={{ marginTop: 8 }}>
              {tags.map((tag, i) => (
                <span key={i} style={{ background: '#1976d2', borderRadius: 6, padding: '2px 8px', fontSize: 13, marginRight: 6, color: '#fff', cursor: 'pointer', fontWeight: 500 }} onClick={() => handleRemoveTag(tag)}>
                  #{tag} ×
                </span>
              ))}
              {tagsList.filter(t => !tags.includes(t)).map((tag, i) => (
                <span key={i} style={{ background: '#f5f5f5', borderRadius: 6, padding: '2px 8px', fontSize: 13, marginRight: 6, color: '#1976d2', cursor: 'pointer', border: '1px solid #1976d2', fontWeight: 500 }} onClick={() => handleAddTag(tag)}>
                  #{tag}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <button type="submit" style={{ background: '#1976d2', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 16, cursor: 'pointer' }}>✔️ Save</button>
            <button type="button" onClick={onClose} style={{ background: '#eee', color: '#333', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 16, cursor: 'pointer' }}>❌ Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
