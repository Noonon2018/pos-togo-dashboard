import React from 'react';

export default function CardList({ cards }) {
  return (
    <div style={{ padding: 16 }}>
      {cards.map((card, idx) => (
        <div key={idx} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, marginBottom: 16, padding: 16, boxShadow: '0 2px 8px #0001' }}>
          <div style={{ fontWeight: 700, fontSize: 18, fontFamily: 'Sarabun, Inter, Arial, sans-serif', color: '#222' }}>{card.th}</div>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#333', marginBottom: 4, fontFamily: 'Sarabun, Inter, Arial, sans-serif' }}>{card.en}</div>
          <div>
            {card.tags.map((tag, i) => (
              <span key={i} style={{ background: '#e0e0e0', borderRadius: 6, padding: '2px 8px', fontSize: 12, marginRight: 6, color: '#333', fontWeight: 600, fontFamily: 'Sarabun, Inter, Arial, sans-serif' }}>#{tag}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
