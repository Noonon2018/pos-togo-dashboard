import React from 'react';

export default function OrderDetailModal({ order, onClose }) {
  if (!order) return null;
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: 'rgba(0,0,0,0.25)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 32, minWidth: 340, maxWidth: 480, boxShadow: '0 4px 24px #0003', position: 'relative', color: '#222' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: '#eee', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontWeight: 600, color: '#222' }}>Close</button>
        <h2 style={{ marginTop: 0, color: '#1976d2', fontWeight: 700 }}>Order Detail</h2>
        <div style={{ marginBottom: 12, color: '#222' }}><b>Supplier:</b> {order.supplier || <span style={{ color: '#bbb' }}>No supplier</span>}</div>
        <div style={{ marginBottom: 12, color: '#222' }}><b>Order Date:</b> {order.orderDate}</div>
        <div style={{ marginBottom: 12, color: '#222' }}><b>Purchase By:</b> {order.purchaseByDate}</div>
        <div style={{ marginBottom: 12, color: '#222' }}><b>Status:</b> {order.status}</div>
        <div style={{ marginBottom: 12, color: '#222' }}><b>Items:</b>
          <ul style={{ paddingLeft: 20, color: '#222' }}>
            {order.items && order.items.length > 0 ? order.items.map((item, idx) => (
              <li key={idx} style={{ marginBottom: 6, color: '#222' }}>
                <span style={{ fontWeight: 600 }}>{item.name}</span> x{item.qty} {item.needCall && <span style={{ color: '#d32f2f', fontWeight: 600, fontSize: 13, border: '1px solid #d32f2f', borderRadius: 4, padding: '1px 6px', marginLeft: 4 }}>Need to call</span>}
                {item.image && item.image.previewUrl && (
                  <img src={item.image.previewUrl} alt="item" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4, marginLeft: 8, verticalAlign: 'middle' }} />
                )}
              </li>
            )) : <li style={{ color: '#bbb' }}>No items</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
