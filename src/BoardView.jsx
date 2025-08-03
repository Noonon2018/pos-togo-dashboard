import React, { useState } from 'react';


import BoardHeader from './components/BoardHeader';
import SearchBar from './components/SearchBar';
import CardList from './components/CardList';
import Fab from './components/Fab';
import CardModal from './components/CardModal';
import OrderListModal from './components/OrderListModal';
import OrderManager from './components/OrderManager';

const initialCards = [
  { th: '1 dozen black pens', en: '1 dozen black pens', tags: ['stationery', 'urgent'] },
  { th: '5 reams of A4 paper', en: '5 reams of A4 paper', tags: ['stationery'] },
  { th: '2 packs of drinking water', en: '2 packs of drinking water', tags: ['office supplies'] },
];

export default function BoardView({ boardName = 'Company', onBack }) {
  const [search, setSearch] = useState('');
  const [cards, setCards] = useState(initialCards);
  const [modalOpen, setModalOpen] = useState(false);

  const filtered = cards.filter(card =>
    (card.th && card.th.includes(search)) ||
    (card.en && card.en.toLowerCase().includes(search.toLowerCase())) ||
    (Array.isArray(card.tags) && card.tags.some(tag => tag && tag.includes(search.replace('#', ''))))
  );

  const [orderModalOpen, setOrderModalOpen] = React.useState(false);
  const handleCreateOrder = () => {
    setOrderModalOpen(true);
  };
  const handleAddCard = () => {
    setModalOpen(true);
  };
  const handleSaveCard = (card) => {
    setCards([...cards, card]);
    setModalOpen(false);
  };

  // รวมแท็กทั้งหมดที่เคยใช้
  const allTags = Array.from(new Set(cards.flatMap(c => c.tags)));


  // OrderManager integration
  const [orderManagerOpen, setOrderManagerOpen] = useState(false);
  const [orderManagerItems, setOrderManagerItems] = useState([]);
  // รวม orderItems จากทั้ง CardList และ OrderManager
  const orderItems = [
    ...cards.map(card => card.en).filter(Boolean),
    ...orderManagerItems.map(item => item.name)
  ];

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: '#f5f5f5' }}>
      <BoardHeader boardName={boardName} onBack={onBack} onCreateOrder={handleCreateOrder} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 24px 12px 24px' }}>
        <button onClick={() => setOrderManagerOpen(true)} style={{ background: '#1976d2', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 16, fontWeight: 600, cursor: 'pointer' }}>
          Open Order Management
        </button>
      </div>
      <SearchBar value={search} onChange={setSearch} />
      {/* Red box for showing OrderManager items */}
      <div style={{ minHeight: 32, margin: '12px 0', border: '2px solid #d32f2f', borderRadius: 8, background: '#fff', padding: '8px 12px', color: '#222', fontSize: 16 }}>
        {orderManagerItems.length === 0 ? (
          <span style={{ color: '#aaa' }}>No order items from Order Management.</span>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {orderManagerItems.map((item, idx) => (
              <li key={idx}>{item.name}{item.needCall ? ' (Need to call)' : ''} <span style={{ color: '#888', fontSize: 13 }}>({item.date})</span></li>
            ))}
          </ul>
        )}
      </div>
      <CardList cards={filtered} />
      <Fab onClick={handleAddCard} />
      <CardModal open={modalOpen} onClose={() => setModalOpen(false)} onSave={handleSaveCard} tagsList={allTags} />
      <OrderListModal open={orderModalOpen} onClose={() => setOrderModalOpen(false)} boardName={boardName} items={orderItems} />
      {orderManagerOpen && (
        <div style={{ position: 'fixed', zIndex: 4000, left: 0, top: 0, width: '100vw', height: '100vh', background: '#0008', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'relative', width: '100%', maxWidth: 520 }}>
            <OrderManager
              items={orderManagerItems}
              onItemsChange={setOrderManagerItems}
            />
            <button onClick={() => setOrderManagerOpen(false)} style={{ position: 'absolute', top: 12, right: 12, background: '#eee', border: 'none', borderRadius: 8, padding: '6px 18px', fontSize: 18, cursor: 'pointer', fontWeight: 600 }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
