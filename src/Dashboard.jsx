import React, { useState } from 'react';
import Header from './components/Header';
import BoardList from './components/BoardList';
import SettingsModal from './components/SettingsModal';

export default function Dashboard({ onBoardSelect }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const handleSettingsClick = () => setSettingsOpen(true);
  const handleBoardClick = (board) => {
    if (onBoardSelect) onBoardSelect(board);
  };
  const handleAddBoard = () => {
    alert('เพิ่มบอร์ดใหม่ (to be implemented)');
  };
  return (
    <div>
      <Header onSettingsClick={handleSettingsClick} />
      <BoardList onBoardClick={handleBoardClick} onAddBoard={handleAddBoard} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
