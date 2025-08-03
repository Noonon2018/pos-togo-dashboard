

import React, { useState } from 'react';
import OrderPad from './OrderPad';
import NewOrder from './NewOrder';
import './App.css';

export default function App() {
  const [screen, setScreen] = useState('orderpad'); // 'orderpad' | 'neworder'
  const [editOrder, setEditOrder] = useState(null); // order object or null

  const handleNewOrder = () => {
    setEditOrder(null);
    setScreen('neworder');
  };

  const handleEditOrder = (order) => {
    setEditOrder(order);
    setScreen('neworder');
  };

  const handleBack = () => {
    setScreen('orderpad');
  };

  return screen === 'orderpad' ? (
    <OrderPad onNewOrder={handleNewOrder} onEditOrder={handleEditOrder} />
  ) : (
    <NewOrder order={editOrder} onBack={handleBack} />
  );
}
