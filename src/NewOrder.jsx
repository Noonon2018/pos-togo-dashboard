  const handleAddOrEdit = () => {
    if (!itemInput.trim()) return;
    const newItem = {
      name: itemInput.trim(),
      needCall,
      qty: qtyInput,
      image: itemImage ? { previewUrl: itemImage.previewUrl, file: itemImage.file } : undefined
    };
    if (editIdx !== null) {
      const updated = [...items];
      updated[editIdx] = newItem;
      setItems(updated);
      setEditIdx(null);
    } else {
      setItems([...items, newItem]);
    }
    setItemInput('');
    setQtyInput(1);
    setNeedCall(false);
    setItemImage(null);
  };
import React, { useState, useRef } from 'react';


const getToday = () => new Date().toISOString().slice(0, 10);

function generateOrderMessage({ supplier, orderDate, purchaseByDate, items }) {
  let msg = `Order for: ${supplier || '-'}\nOrder date: ${orderDate}\nPurchase by: ${purchaseByDate}\n\nItems:`;
  if (!items.length) return msg + ' None';
  items.forEach((item, idx) => {
    msg += `\n${idx + 1}. ${item.name} ${item.needCall ? '[Need to call]' : ''} ${item.qty ? 'x' + item.qty : ''}`;
    if (item.image && item.image.previewUrl) {
      msg += `\n  [See example image: ${item.image.previewUrl}]`;
    }
  });
  return msg;
}

export default function NewOrder({ order, onBack }) {
  // For attaching image to item being added
  // If editing, pre-fill fields from order prop
  const [itemImage, setItemImage] = useState(null); // { file, previewUrl }
  const [orderDate, setOrderDate] = useState(order?.orderDate || getToday());
  const [purchaseByDate, setPurchaseByDate] = useState(order?.purchaseByDate || getToday());
  const [items, setItems] = useState(order?.items || []);
  const [itemInput, setItemInput] = useState('');
  // Item autocomplete state
  const [itemList, setItemList] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('item_list') || '[]');
    } catch {
      return [];
    }
  });
  // Remember last used qty for each item
  const [itemQtyMap, setItemQtyMap] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('item_qty_map') || '{}');
    } catch {
      return {};
    }
  });
  const [showItemDropdown, setShowItemDropdown] = useState(false);
  const [itemInputRef, setItemInputRef] = useState(null);
  const [qtyInput, setQtyInput] = useState(1);
  const [needCall, setNeedCall] = useState(false);
  const [editIdx, setEditIdx] = useState(null);
  const [copied, setCopied] = useState(false);

  // Sync form state with order prop when editing
  React.useEffect(() => {
    if (order) {
      setOrderDate(order.orderDate || getToday());
      setPurchaseByDate(order.purchaseByDate || getToday());
      setItems(order.items || []);
      setSupplier(order.supplier || '');
      setSupplierInput(order.supplier || '');
    }
  }, [order]);

  // Add or edit item logic
  const handleAddOrEdit = () => {
    if (!itemInput.trim()) return;
    const newItem = {
      name: itemInput.trim(),
      needCall,
      qty: qtyInput,
      image: itemImage ? { previewUrl: itemImage.previewUrl, file: itemImage.file } : undefined
    };
    if (editIdx !== null) {
      const updated = [...items];
      updated[editIdx] = newItem;
      setItems(updated);
      setEditIdx(null);
    } else {
      setItems([...items, newItem]);
    }
    // Add to item list if not present
    if (itemInput.trim() && !itemList.some(i => i.toLowerCase() === itemInput.trim().toLowerCase())) {
      const updated = [itemInput.trim(), ...itemList];
      setItemList(updated);
      localStorage.setItem('item_list', JSON.stringify(updated));
    }
    // Save last used qty for this item
    if (itemInput.trim()) {
      const newMap = { ...itemQtyMap, [itemInput.trim()]: qtyInput };
      setItemQtyMap(newMap);
      localStorage.setItem('item_qty_map', JSON.stringify(newMap));
    }
    setItemInput('');
    setQtyInput(1);
    setNeedCall(false);
    setItemImage(null);
    setShowItemDropdown(false);
  };
  // Filtered item suggestions
  const filteredItems = itemInput
    ? itemList.filter(i => i.toLowerCase().includes(itemInput.toLowerCase()))
    : itemList;

  // Handle click outside item dropdown
  React.useEffect(() => {
    if (!showItemDropdown) return;
    function onClick(e) {
      if (itemInputRef && !itemInputRef.contains(e.target)) {
        setShowItemDropdown(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showItemDropdown, itemInputRef]);
  // Supplier autocomplete state
  const [supplier, setSupplier] = useState(order?.supplier || localStorage.getItem('order_supplier') || '');
  const [supplierList, setSupplierList] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('supplier_list') || '[]');
    } catch {
      return [];
    }
  });
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const [supplierInput, setSupplierInput] = useState(order?.supplier || supplier);
  // Save order to localStorage
  function saveOrderToStorage(orderObj, status) {
    const orders = (() => {
      try {
        return JSON.parse(localStorage.getItem('orders') || '[]');
      } catch {
        return [];
      }
    })();
    let newOrders;
    if (order && order.id) {
      // Edit existing order
      newOrders = orders.map(o => (o.id === order.id ? { ...orderObj, id: order.id, status } : o));
    } else {
      // New order
      const newId = Date.now().toString();
      newOrders = [
        { ...orderObj, id: newId, status },
        ...orders,
      ];
    }
    localStorage.setItem('orders', JSON.stringify(newOrders));
  }

  // Save Draft handler
  function handleSaveDraft() {
    const orderObj = {
      supplier: supplierInput,
      orderDate,
      purchaseByDate,
      items,
    };
    // Always update the correct order (edit or new)
    saveOrderToStorage(orderObj, order && order.id ? 'DRAFT' : 'DRAFT');
    if (onBack) onBack();
  }

  // Send Order handler
  function handleSendOrder() {
    const orderObj = {
      supplier: supplierInput,
      orderDate,
      purchaseByDate,
      items,
    };
    saveOrderToStorage(orderObj, 'SENT');
    if (onBack) onBack();
  }
  const supplierInputRef = useRef();

  // Save supplier/store to localStorage and update input
  const handleSupplierChange = e => {
    const val = e.target.value;
    setSupplierInput(val);
    setShowSupplierDropdown(true);
  };

  // When user selects a supplier from dropdown or adds new
  const selectSupplier = name => {
    setSupplier(name);
    setSupplierInput(name);
    setShowSupplierDropdown(false);
    localStorage.setItem('order_supplier', name);
    // Add to supplier list if not present
    if (!supplierList.includes(name)) {
      const updated = [name, ...supplierList];
      setSupplierList(updated);
      localStorage.setItem('supplier_list', JSON.stringify(updated));
    }
  };

  // Filtered suggestions
  const filteredSuppliers = supplierInput
    ? supplierList.filter(s => s.toLowerCase().includes(supplierInput.toLowerCase()))
    : supplierList;

  // Handle click outside dropdown
  React.useEffect(() => {
    if (!showSupplierDropdown) return;
    function onClick(e) {
      if (supplierInputRef.current && !supplierInputRef.current.contains(e.target)) {
        setShowSupplierDropdown(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showSupplierDropdown]);


  const handleEdit = idx => {
    setEditIdx(idx);
    setItemInput(items[idx].name);
    setQtyInput(items[idx].qty || 1);
    setNeedCall(items[idx].needCall);
  };

  const handleDelete = idx => {
    const updated = items.filter((_, i) => i !== idx);
    setItems(updated);
    if (editIdx === idx) {
      setEditIdx(null);
      setItemInput('');
      setQtyInput(1);
      setNeedCall(false);
    }
  };

  const orderMsg = generateOrderMessage({ supplier, orderDate, purchaseByDate, items });

  const handleCopy = () => {
    navigator.clipboard.writeText(orderMsg);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  // Print logic: open popup with orderMsg and call print
  function handlePrint() {
    const printWindow = window.open('', '', 'width=700,height=900');
    if (!printWindow) return;
    const html = [
      '<html>',
      '<head>',
      '<title>Print Order</title>',
      '<style>',
      'body { font-family: Arial, sans-serif; padding: 32px; background: #fff; color: #222; }',
      'h2 { margin-top: 0; }',
      'pre { font-size: 16px; white-space: pre-wrap; word-break: break-word; }',
      '</style>',
      '</head>',
      '<body>',
      '<h2>Order Message</h2>',
      `<pre>${orderMsg.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`,
      '<script>window.onload = function() { window.print(); }<\/script>',
      '</body>',
      '</html>'
    ].join('');
    printWindow.document.write(html);
    printWindow.document.close();
  }
  return (
    <div className="neworder-main" style={{ maxWidth: 540, width: '100vw', minHeight: '100vh', margin: '0 auto', background: '#fff', borderRadius: 14, boxShadow: '0 4px 24px #0002', padding: 32, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ margin: 0, color: '#222', fontSize: 28, fontWeight: 700, letterSpacing: 0.5 }}>{order ? 'Edit Order' : 'New Order'}</h1>
        {onBack && (
          <button onClick={onBack} style={{ background: '#eee', color: '#222', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 16, cursor: 'pointer', fontWeight: 600 }}>Back</button>
        )}
      </div>
      <div style={{ marginBottom: 18, position: 'relative' }} ref={supplierInputRef}>
        <label style={{ fontWeight: 600 }}>Supplier / Store Name</label>
        <input
          value={supplierInput}
          onChange={handleSupplierChange}
          onFocus={() => setShowSupplierDropdown(true)}
          placeholder="Enter supplier or store name (e.g. Staples, H-E-B, Home Depot)"
          style={{ width: '100%', fontSize: 16, marginTop: 4, marginBottom: 8, padding: 8, borderRadius: 6, border: '1px solid #bbb' }}
        />
        {showSupplierDropdown && (
          <div style={{
            position: 'absolute',
            top: 54,
            left: 0,
            width: '100%',
            background: '#fff',
            border: '1px solid #bbb',
            borderRadius: 6,
            boxShadow: '0 2px 12px #0001',
            zIndex: 10,
            maxHeight: 180,
            overflowY: 'auto',
          }}>
            {/* Add option if not found */}
            {supplierInput && !supplierList.some(s => s.toLowerCase() === supplierInput.toLowerCase()) && (
              <div
                style={{ padding: '10px 16px', cursor: 'pointer', color: '#1976d2', fontWeight: 600, borderBottom: filteredSuppliers.length ? '1px solid #eee' : 'none' }}
                onMouseDown={e => { e.preventDefault(); selectSupplier(supplierInput); }}
              >
                + Add "{supplierInput}" to my list
              </div>
            )}
            {filteredSuppliers.map((s, i) => (
              <div
                key={s}
                style={{ padding: '10px 16px', cursor: 'pointer', color: s === supplier ? '#1976d2' : '#222', background: s === supplier ? '#e3f0fd' : '#fff' }}
                onMouseDown={e => { e.preventDefault(); selectSupplier(s); }}
              >
                {s}
              </div>
            ))}
            {!filteredSuppliers.length && !supplierInput && (
              <div style={{ padding: '10px 16px', color: '#888' }}>No suppliers yet</div>
            )}
          </div>
        )}
        {/* Supplier list UI */}
        {supplierList.length > 0 && (
          <div style={{ margin: '4px 0 12px 0', fontSize: 14, color: '#555' }}>
            <span style={{ fontWeight: 600, marginRight: 8 }}>My suppliers:</span>
            {supplierList.map(s => (
              <span key={s} style={{
                display: 'inline-flex',
                alignItems: 'center',
                background: '#f5f5f5',
                border: '1px solid #ddd',
                borderRadius: 12,
                padding: '2px 10px',
                marginRight: 6,
                marginBottom: 2,
              }}>
                <span
                  onClick={() => selectSupplier(s)}
                  style={{
                    cursor: 'pointer',
                    fontWeight: 600,
                    color: '#222',
                    userSelect: 'none',
                  }}
                  title={`Select ${s}`}
                >
                  {s}
                </span>
                <span
                  onClick={() => {
                    const updated = supplierList.filter(x => x !== s);
                    setSupplierList(updated);
                    localStorage.setItem('supplier_list', JSON.stringify(updated));
                    // If current supplier is removed, clear input
                    if (supplier === s) {
                      setSupplier('');
                      setSupplierInput('');
                      localStorage.removeItem('order_supplier');
                    }
                  }}
                  style={{
                    marginLeft: 6,
                    color: '#d32f2f',
                    cursor: 'pointer',
                    fontWeight: 700,
                    fontSize: 15,
                    userSelect: 'none',
                  }}
                  title={`Remove ${s}`}
                >
                  ×
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
      <div style={{ marginBottom: 18, display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontWeight: 600 }}>Order Date</label>
          <input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)} style={{ width: '100%', fontSize: 16, marginTop: 4, marginBottom: 8, padding: 8, borderRadius: 6, border: '1px solid #bbb' }} />
          <div style={{ color: '#888', fontSize: 13, marginTop: -4, marginBottom: 4 }}>{new Date(orderDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ fontWeight: 600 }}>Purchase-By Date</label>
          <input type="date" value={purchaseByDate} onChange={e => setPurchaseByDate(e.target.value)} style={{ width: '100%', fontSize: 16, marginTop: 4, marginBottom: 8, padding: 8, borderRadius: 6, border: '1px solid #bbb' }} />
          <div style={{ color: '#888', fontSize: 13, marginTop: -4, marginBottom: 4 }}>{new Date(purchaseByDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>
      </div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: 2, position: 'relative' }} ref={el => setItemInputRef(el)}>
          <input
            value={itemInput}
            onChange={e => {
              setItemInput(e.target.value);
              setShowItemDropdown(true);
            }}
            onFocus={() => setShowItemDropdown(true)}
            placeholder="Add or edit order item"
            style={{ width: '100%', fontSize: 16, padding: 8, borderRadius: 6, border: '1px solid #bbb' }}
          />
          {showItemDropdown && (
            <div style={{
              position: 'absolute',
              top: 40,
              left: 0,
              width: '100%',
              background: '#fff',
              border: '1px solid #bbb',
              borderRadius: 6,
              boxShadow: '0 2px 12px #0001',
              zIndex: 20,
              maxHeight: 180,
              overflowY: 'auto',
            }}>
              {/* Add option if not found */}
              {itemInput && !itemList.some(i => i.toLowerCase() === itemInput.toLowerCase()) && (
                <div
                  style={{ padding: '10px 16px', cursor: 'pointer', color: '#1976d2', fontWeight: 600, borderBottom: filteredItems.length ? '1px solid #eee' : 'none' }}
                  onMouseDown={e => { e.preventDefault(); setItemInput(itemInput); setShowItemDropdown(false); }}
                >
                  + Add "{itemInput}"
                </div>
              )}
              {filteredItems.map((i, idx) => (
                <div
                  key={i}
                  style={{ padding: '10px 16px', cursor: 'pointer', color: i === itemInput ? '#1976d2' : '#222', background: i === itemInput ? '#e3f0fd' : '#fff' }}
                  onMouseDown={e => {
                    e.preventDefault();
                    setItemInput(i);
                    // Autofill qty if known
                    if (itemQtyMap[i] !== undefined) setQtyInput(itemQtyMap[i]);
                    setShowItemDropdown(false);
                  }}
                >
                  {i}
                </div>
              ))}
              {!filteredItems.length && !itemInput && (
                <div style={{ padding: '10px 16px', color: '#888' }}>No items yet</div>
              )}
            </div>
          )}
        </div>
        <input
          type="number"
          min={1}
          value={qtyInput}
          onChange={e => setQtyInput(Math.max(1, Number(e.target.value)))}
          placeholder="Qty"
          style={{ width: 60, fontSize: 16, padding: 8, borderRadius: 6, border: '1px solid #bbb' }}
        />
        {/* Attach image button */}
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', margin: 0 }} title="Attach image">
          <span role="img" aria-label="attach image" style={{ fontSize: 22, marginRight: 2 }}>🖼️</span>
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files && e.target.files[0];
              if (file) {
                const previewUrl = URL.createObjectURL(file);
                setItemImage({ file, previewUrl });
              }
            }}
          />
        </label>
        {/* Show thumbnail if image selected */}
        {itemImage && (
          <img src={itemImage.previewUrl} alt="preview" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4, marginLeft: 2 }} />
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14 }}>
          <input type="checkbox" checked={needCall} onChange={e => setNeedCall(e.target.checked)} />
          Need to call
        </label>
        <button onClick={handleAddOrEdit} style={{ background: '#1976d2', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 16, cursor: 'pointer', fontWeight: 600 }}>
          {editIdx !== null ? 'Update' : 'Add'}
        </button>
      </div>
      <ul style={{ paddingLeft: 20, marginBottom: 24 }}>
        {items.map((item, idx) => (
          <li key={idx} style={{ marginBottom: 8, fontSize: 16, color: '#222', display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Show thumbnail if item has image */}
            {item.image && item.image.previewUrl && (
              <img src={item.image.previewUrl} alt="item" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4, marginRight: 4 }} />
            )}
            <span>{item.name}</span>
            {item.needCall && <span style={{ color: '#d32f2f', fontWeight: 600, fontSize: 13, border: '1px solid #d32f2f', borderRadius: 4, padding: '1px 6px' }}>Need to call</span>}
            <span style={{ color: '#888', fontSize: 13 }}>Qty: {item.qty}</span>
            <button onClick={() => handleEdit(idx)} style={{ marginLeft: 8, fontSize: 14, background: '#eee', border: 'none', borderRadius: 4, padding: '2px 10px', cursor: 'pointer' }}>Edit</button>
            <button onClick={() => handleDelete(idx)} style={{ fontSize: 14, background: '#ffd6d6', border: 'none', borderRadius: 4, padding: '2px 10px', cursor: 'pointer', color: '#d32f2f' }}>Delete</button>
          </li>
        ))}
      </ul>
      <div style={{ marginBottom: 18, position: 'relative' }}>
        <label style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>Order Message</label>
        <textarea value={orderMsg} readOnly rows={Math.max(5, orderMsg.split('\n').length)} style={{ width: '100%', fontSize: 15, padding: 10, borderRadius: 6, border: '1px solid #bbb', background: '#f9f9f9', color: '#222', resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
          <button onClick={handlePrint} style={{ background: '#ff9800', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 16, cursor: 'pointer', fontWeight: 600 }}>
            Print
          </button>
          <button onClick={handleCopy} style={{ background: copied ? '#43a047' : '#1976d2', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 16, cursor: 'pointer', fontWeight: 600 }}>
            {copied ? 'Copied!' : 'Copy to clipboard'}
          </button>
          <button onClick={handleSaveDraft} style={{ background: '#bfa100', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 16, cursor: 'pointer', fontWeight: 600 }}>
            Save Draft
          </button>
          <button onClick={handleSendOrder} style={{ background: '#388e3c', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', fontSize: 16, cursor: 'pointer', fontWeight: 600 }}>
            {order ? 'Update & Send' : 'Send Order'}
          </button>
        </div>
      </div>
    </div>
  );
}
