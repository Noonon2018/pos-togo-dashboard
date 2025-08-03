import React, { useState, useEffect } from 'react';
import OrderDetailModal from './components/OrderDetailModal';

// Helper: load orders from localStorage
function loadOrders() {
  try {
    return JSON.parse(localStorage.getItem('orders') || '[]');
  } catch {
    return [];
  }
}

export default function OrderPad({ onNewOrder, onEditOrder }) {
  const [orders, setOrders] = useState([]);
  const [viewOrder, setViewOrder] = useState(null); // for viewing history detail

  useEffect(() => {
    setOrders(loadOrders());
  }, []);

  // Split orders by status
  const drafts = orders.filter(o => o.status === 'DRAFT');
  const history = orders.filter(o => o.status === 'SENT');

  return (
    <div className="orderpad-main" style={{ maxWidth: 700, width: '100vw', minHeight: '100vh', margin: '0 auto', background: '#fff', borderRadius: 14, boxShadow: '0 4px 24px #0002', padding: 32, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <h1 style={{ color: '#1976d2', fontWeight: 700, fontSize: 32, margin: 0 }}>OrderPad</h1>
        <button onClick={onNewOrder} style={{ background: '#1976d2', color: '#fff', fontWeight: 700, fontSize: 20, border: 'none', borderRadius: 8, padding: '12px 32px', cursor: 'pointer', boxShadow: '0 2px 8px #0001' }}>+ New Order</button>
      </div>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#222', marginBottom: 12 }}>Drafts</h2>
        {drafts.length === 0 ? (
          <div style={{ color: '#888', fontSize: 16, marginBottom: 16 }}>No drafts yet.</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {drafts.map((order, idx) => (
              <li key={order.id || idx} style={{ background: '#f7faff', border: '1px solid #b3d1f7', borderRadius: 8, marginBottom: 12, padding: '16px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#222' }} onClick={() => onEditOrder(order)}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 18, color: '#222' }}>{order.supplier || <span style={{ color: '#bbb' }}>No supplier</span>}</div>
                  <div style={{ color: '#222', fontSize: 15 }}>Order Date: {order.orderDate}</div>
                </div>
                <span style={{ background: '#fffbe6', color: '#bfa100', border: '1px solid #ffe082', borderRadius: 6, fontWeight: 700, fontSize: 14, padding: '2px 12px' }}>[ DRAFT ]</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#222', marginBottom: 12 }}>History</h2>
        {history.length === 0 ? (
          <div style={{ color: '#888', fontSize: 16 }}>No sent orders yet.</div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {history.map((order, idx) => (
              <li
                key={order.id || idx}
                style={{ background: '#f9f9f9', border: '1px solid #eee', borderRadius: 8, marginBottom: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#222', cursor: 'pointer' }}
                onClick={() => setViewOrder(order)}
                title="View order detail"
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 18, color: '#222' }}>{order.supplier || <span style={{ color: '#bbb' }}>No supplier</span>}</div>
                  <div style={{ color: '#222', fontSize: 15 }}>Order Date: {order.orderDate}</div>
                </div>
                <span style={{ background: '#e3f7e7', color: '#388e3c', border: '1px solid #b2dfdb', borderRadius: 6, fontWeight: 700, fontSize: 14, padding: '2px 12px' }}>[ SENT ]</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {viewOrder && (
        <OrderDetailModal order={viewOrder} onClose={() => setViewOrder(null)} />
      )}
    </div>
  );
}
