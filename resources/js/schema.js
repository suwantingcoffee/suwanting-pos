const text = (key, label, max = 120, required = true) => ({ key, label, type: 'text', max, required });
const number = (key, label, step = '0.01', value = '0') => ({ key, label, type: 'number', step, min: 0, value, required: true });
const select = (key, label, source, value = '') => ({ key, label, type: 'select', source, value, required: true });
const active = { key: 'is_active', label: 'Aktif', type: 'checkbox', value: true };
export const schemas = {
    categories: { label: 'Kategori', capability: 'catalog', fields: [text('name', 'Nama kategori', 80), active] },
    customers: { label: 'Pelanggan', capability: 'customers', fields: [text('name', 'Nama pelanggan'), text('phone', 'Telepon', 30, false), { ...text('email', 'Email', 120, false), type: 'email' }, text('address', 'Alamat', 255, false), { ...text('notes', 'Catatan', 1000, false), type: 'textarea' }, active] },
    products: { label: 'Produk', capability: 'catalog', fields: [text('name', 'Nama produk'), text('sku', 'SKU', 60), select('category_id', 'Kategori', 'categories'), select('product_type', 'Jenis produk', 'productTypes', 'drink'), number('selling_price', 'Harga jual (Rp)'), number('cost_price', 'Harga modal (Rp)'), { ...text('description', 'Deskripsi', 1000, false), type: 'textarea' }, active] },
    units: { label: 'Satuan dasar', capability: 'catalog', fields: [text('name', 'Nama satuan', 60), text('symbol', 'Simbol', 15)] },
    ingredients: { label: 'Bahan baku', capability: 'catalog', fields: [text('name', 'Nama bahan'), text('sku', 'SKU bahan', 60), select('inventory_unit_id', 'Satuan dasar', 'units'), number('minimum_stock', 'Stok minimum', '0.001'), active] },
    recipes: { label: 'Resep', capability: 'catalog', fields: [select('product_id', 'Produk', 'products'), { ...select('product_variant_id', 'Varian', 'recipeVariants'), required: false }, active] },
    profiles: { label: 'Pengguna', capability: 'owner', fields: [text('name', 'Nama pengguna', 100), { ...text('email', 'Email', 255), type: 'email' }, select('role', 'Role', 'roles', 'cashier'), active, { key: 'can_manage_catalog', label: 'Admin boleh mengelola katalog dan inventori', type: 'checkbox', value: false }, { key: 'can_discount', label: 'Admin boleh memberi diskon', type: 'checkbox', value: false }] },
};

export const navigation = [
    { page: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard' },
    { page: 'pos', label: 'Kasir', icon: 'shopping-bag' },
    { page: 'transactions', label: 'Transaksi', icon: 'receipt-text' },
    { page: 'customers', label: 'Pelanggan', icon: 'user-plus' },
    { page: 'products', label: 'Produk & menu', icon: 'package', capability: 'catalog' },
    { page: 'categories', label: 'Kategori', icon: 'tags', capability: 'catalog' },
    { page: 'inventory', label: 'Inventori & resep', icon: 'warehouse', capability: 'catalog' },
    { page: 'reports', label: 'Laporan', icon: 'chart-no-axes-combined', capability: 'owner' },
    { page: 'users', label: 'Pengguna', icon: 'users', capability: 'owner' },
    { page: 'audit', label: 'Audit aktivitas', icon: 'history', capability: 'owner' },
    { page: 'settings', label: 'Pengaturan', icon: 'settings', capability: 'owner' },
];

export const columns = {
    categories: [{ key: 'name', label: 'Nama' }, { key: 'is_active', label: 'Status', type: 'status' }],
    products: [{ key: 'name', label: 'Produk' }, { key: 'sku', label: 'SKU' }, { key: 'category_name', label: 'Kategori' }, { key: 'selling_price', label: 'Harga', type: 'money' }, { key: 'is_active', label: 'Status', type: 'status' }],
    customers: [{ key: 'name', label: 'Nama' }, { key: 'phone', label: 'Telepon' }, { key: 'email', label: 'Email' }, { key: 'is_active', label: 'Status', type: 'status' }],
    ingredients: [{ key: 'name', label: 'Bahan' }, { key: 'sku', label: 'SKU' }, { key: 'stock_quantity', label: 'Stok', type: 'stock' }, { key: 'minimum_stock', label: 'Minimum', type: 'quantity' }, { key: 'symbol', label: 'Satuan' }, { key: 'is_active', label: 'Status', type: 'status' }],
    units: [{ key: 'name', label: 'Satuan' }, { key: 'symbol', label: 'Simbol' }],
    recipes: [{ key: 'product_name', label: 'Produk' }, { key: 'variant_name', label: 'Varian' }, { key: 'items', label: 'Bahan', type: 'recipe' }, { key: 'is_active', label: 'Status', type: 'status' }],
    movements: [{ key: 'created_at', label: 'Tanggal', type: 'date' }, { key: 'ingredient_name', label: 'Bahan' }, { key: 'type', label: 'Jenis' }, { key: 'quantity', label: 'Jumlah', type: 'quantity' }, { key: 'stock_before', label: 'Sebelum', type: 'quantity' }, { key: 'stock_after', label: 'Sesudah', type: 'quantity' }, { key: 'unit_symbol', label: 'Satuan' }, { key: 'reference', label: 'Referensi' }, { key: 'reason', label: 'Alasan' }, { key: 'user_name', label: 'Pengguna' }],
    usage: [{ key: 'ingredient_name', label: 'Bahan' }, { key: 'quantity_used', label: 'Pemakaian', type: 'quantity' }, { key: 'unit_symbol', label: 'Satuan' }, { key: 'sale_count', label: 'Transaksi lunas' }],
    profiles: [{ key: 'name', label: 'Nama' }, { key: 'email', label: 'Email' }, { key: 'role', label: 'Role' }, { key: 'is_active', label: 'Status', type: 'status' }],
    sales: [{ key: 'invoice_number', label: 'Invoice' }, { key: 'created_at', label: 'Tanggal', type: 'date' }, { key: 'customer_name', label: 'Pelanggan' }, { key: 'cashier_name', label: 'Kasir' }, { key: 'payment_method', label: 'Metode' }, { key: 'total', label: 'Total', type: 'money' }, { key: 'status', label: 'Status', type: 'payment' }],
    audit: [{ key: 'created_at', label: 'Tanggal', type: 'date' }, { key: 'user_name', label: 'Pengguna' }, { key: 'action', label: 'Tindakan' }, { key: 'entity_id', label: 'Referensi' }],
};
