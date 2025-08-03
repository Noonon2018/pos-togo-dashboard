import React from 'react';

const boards = [
  { name: 'บริษัท', icon: '🏢' },
  { name: 'ตลาด', icon: '🛒' },
  { name: 'ซ่อมแซม', icon: '🛠️' },
];

export default function BoardList({ onBoardClick, onAddBoard }) {
  return (
    <div style={{ display: 'flex', overflowX: 'auto', padding: 16 }}>
      {boards.map((board, idx) => (
        <div
          key={idx}
          style={{ minWidth: 200, marginRight: 16, padding: 24, border: '1px solid #ccc', borderRadius: 8, textAlign: 'center', fontSize: 24, cursor: 'pointer', background: '#fff', color: '#111' }}
          onClick={() => onBoardClick(board)}
        >
          {board.icon} <br /> บอร์ด: {board.name}
        </div>
      ))}
         <div
           style={{ minWidth: 200, padding: 24, border: '1px dashed #aaa', borderRadius: 8, textAlign: 'center', fontSize: 24, cursor: 'pointer', background: '#fafafa', color: '#111' }}
           onClick={onAddBoard}
         >
           + เพิ่มบอร์ดใหม่
         </div>
    </div>
  );
}
