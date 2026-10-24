import React, { useState, useEffect, useRef } from 'react';
import OrderDetailModal from './components/OrderDetailModal';
import { loadOrders, orderTotal, formatMoney, monthlySpend, exportBackup, importBackup, exportCSV } from './orderStorage';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const backupButtonStyle = { background: '#eee', color: '#1976d2', border: 'none', borderRadius: 6, padding: '8px 14px', fontSize: 15, cursor: 'pointer', fontWeight: 600 };

export default function OrderPad({ onNewOrder, onEditOrder }) {
  // Responsive CSS for mobile
  const responsiveStyle = `
    @media (max-width: 600px) {
      html, body {
        background: #fff !important;
      }
      .orderpad-main {
        padding: 0 !important;
        max-width: 90vw !important;
        min-height: 90vh !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        margin: 0 !important;
        width: 90vw !important;
      }
      .orderpad-main h1 {
        font-size: 20px !important;
      }
      .orderpad-main h2 {
        font-size: 16px !important;
      }
      .orderpad-main input,
      .orderpad-main select,
      .orderpad-main textarea {
        font-size: 15px !important;
        padding: 8px 6px !important;
      }
      .orderpad-main button {
        font-size: 15px !important;
        padding: 8px 10px !important;
        min-width: 60px !important;
      }
      .orderpad-main ul {
        padding-left: 10px !important;
      }
      .orderpad-main label {
        font-size: 14px !important;
      }
      .orderpad-main section {
        margin-bottom: 18px !important;
      }
    }
  `;
  const [orders, setOrders] = useState([]);
  const [viewOrder, setViewOrder] = useState(null); // for viewing history detail

  const [month, setMonth] = useState(thisMonth);
  const importInputRef = useRef(null);

  useEffect(() => {
    setOrders(loadOrders());
  }, []);

  async function handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const count = importBackup(await file.text());
      setOrders(loadOrders());
      alert(`Imported ${count} orders. Orders already on this device were kept.`);
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  }

  const spend = monthlySpend(orders, month);

  // Split orders by status
  const drafts = orders.filter(o => o.status === 'DRAFT');
  const history = orders.filter(o => o.status === 'SENT');

  return (
    <>
      <style>{responsiveStyle}</style>
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
                  {orderTotal(order) > 0 && <div style={{ color: '#555', fontSize: 15 }}>Total: {formatMoney(orderTotal(order))}</div>}
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
                  {orderTotal(order) > 0 && <div style={{ color: '#555', fontSize: 15 }}>Total: {formatMoney(orderTotal(order))}</div>}
                </div>
                <span style={{ background: '#e3f7e7', color: '#388e3c', border: '1px solid #b2dfdb', borderRadius: 6, fontWeight: 700, fontSize: 14, padding: '2px 12px' }}>[ SENT ]</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#222', margin: 0 }}>Monthly Spend</h2>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ fontSize: 15, padding: 6, borderRadius: 6, border: '1px solid #1976d2', color: '#111', background: '#fff' }} />
        </div>
        {spend.rows.length === 0 ? (
          <div style={{ color: '#888', fontSize: 16 }}>No sent orders this month.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 16, color: '#222' }}>
            <tbody>
              {spend.rows.map(r => (
                <tr key={r.supplier} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '8px 4px' }}>{r.supplier}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'right' }}>{formatMoney(r.total)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ padding: '8px 4px', fontWeight: 700 }}>Total</td>
                <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 700 }}>{formatMoney(spend.total)}</td>
              </tr>
            </tbody>
          </table>
        )}
        <div style={{ color: '#888', fontSize: 13, marginTop: 6 }}>Sent orders only. Items without a price count as $0.</div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#222', marginBottom: 6 }}>Backup</h2>
        <div style={{ color: '#888', fontSize: 14, marginBottom: 12 }}>Data is stored only in this browser. Download a backup regularly.</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={exportBackup} style={backupButtonStyle}>Download backup (.json)</button>
          <button onClick={() => importInputRef.current && importInputRef.current.click()} style={backupButtonStyle}>Restore backup</button>
          <button onClick={() => exportCSV(orders)} style={backupButtonStyle}>Export for Excel (.csv)</button>
          <input ref={importInputRef} type="file" accept=".json,application/json" onChange={handleImportFile} style={{ display: 'none' }} />
        </div>
      </section>
      {viewOrder && (
        <OrderDetailModal order={viewOrder} onClose={() => setViewOrder(null)} />
      )}
      </div>
    </>
  );
}
