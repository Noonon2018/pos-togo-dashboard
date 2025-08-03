import React, { useState, useRef } from 'react';

const getToday = () => new Date().toISOString().slice(0, 10);

  // Supplier autocomplete state
  const [supplier, setSupplier] = useState(localStorage.getItem('order_supplier') || '');
  const [supplierList, setSupplierList] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('supplier_list') || '[]');
    } catch {
      return [];
    }
  });
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const [supplierInput, setSupplierInput] = useState(supplier);
  const supplierInputRef = useRef();
  const [orderDate, setOrderDate] = useState(getToday());
  const [purchaseByDate, setPurchaseByDate] = useState(getToday());
  const [itemInput, setItemInput] = useState('');
  const [needCall, setNeedCall] = useState(false);
  const [editIdx, setEditIdx] = useState(null);

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

  const handleAddOrEdit = () => {
    if (!itemInput.trim()) return;
    const newItem = { name: itemInput.trim(), needCall, date: orderDate };
    if (editIdx !== null) {
      const updated = [...items];
      updated[editIdx] = newItem;
      onItemsChange && onItemsChange(updated);
      setEditIdx(null);
    } else {
      onItemsChange && onItemsChange([...items, newItem]);
    }
    setItemInput('');
    setNeedCall(false);
  };

  const handleEdit = idx => {
    setEditIdx(idx);
    setItemInput(items[idx].name);
    setNeedCall(items[idx].needCall);
  };

  const handleDelete = idx => {
    const updated = items.filter((_, i) => i !== idx);
    onItemsChange && onItemsChange(updated);
    if (editIdx === idx) {
      setEditIdx(null);
      setItemInput('');
      setNeedCall(false);
    }
  };

  return (
    <div style={{ maxWidth: 480, margin: '40px auto', background: '#fff', borderRadius: 12, boxShadow: '0 4px 24px #0002', padding: 32 }}>
      <h2 style={{ marginTop: 0, marginBottom: 24, color: '#222' }}>Order Management</h2>
      {/* ...existing code... (OrderManager content except supplier UI) */}
    </div>
  );
}


// Helper to parse YYYY-MM-DD as local date
function formatLocalDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}
