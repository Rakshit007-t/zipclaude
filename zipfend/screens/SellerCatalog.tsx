import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { listProducts, bulkOperation, duplicateProduct, SellerProduct } from '../services/ziprightApi';

const ITEMS_PER_PAGE = 8;

const SellerCatalog: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [products, setProducts] = useState<SellerProduct[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Sorting States
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'draft' | 'archived' | 'all'>('all');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'title_asc' | 'title_desc' | 'price_asc' | 'price_desc'>('newest');

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Unique Categories/Brands for filter dropdowns
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [allBrands, setAllBrands] = useState<string[]>([]);

  // Fetch products
  const fetchCatalog = async () => {
    try {
      setLoading(true);
      // Fetch 'all' status first so we can extract filter metadata
      const res = await listProducts({ status_filter: 'all' });
      setProducts(res);

      // Extract unique categories and brands
      const cats = Array.from(new Set(res.map(p => p.category).filter(Boolean))) as string[];
      const brands = Array.from(new Set(res.map(p => p.brand).filter(Boolean))) as string[];
      setAllCategories(cats);
      setAllBrands(brands);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Failed to fetch catalog.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCatalog();
  }, []);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
    setSelectedIds([]);
  }, [searchQuery, statusFilter, selectedCategory, selectedBrand, sortBy]);

  // Client-side filtering & sorting
  const filteredProducts = products.filter((p) => {
    // Search match
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = p.title.toLowerCase().includes(q);
      const matchBrand = (p.brand || '').toLowerCase().includes(q);
      const matchCat = (p.category || '').toLowerCase().includes(q);
      const matchTags = (p.tags || []).some(t => t.toLowerCase().includes(q));
      if (!matchTitle && !matchBrand && !matchCat && !matchTags) return false;
    }

    // Status match
    if (statusFilter !== 'all') {
      if (p.status !== statusFilter) return false;
    }

    // Category match
    if (selectedCategory && p.category !== selectedCategory) return false;

    // Brand match
    if (selectedBrand && p.brand !== selectedBrand) return false;

    return true;
  }).sort((a, b) => {
    if (sortBy === 'newest') {
      const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return tb - ta;
    }
    if (sortBy === 'oldest') {
      const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return ta - tb;
    }
    if (sortBy === 'title_asc') {
      return a.title.localeCompare(b.title);
    }
    if (sortBy === 'title_desc') {
      return b.title.localeCompare(a.title);
    }
    if (sortBy === 'price_asc') {
      const pa = parseFloat((a.price || '0').replace(/[^0-9.]/g, '')) || 0;
      const pb = parseFloat((b.price || '0').replace(/[^0-9.]/g, '')) || 0;
      return pa - pb;
    }
    if (sortBy === 'price_desc') {
      const pa = parseFloat((a.price || '0').replace(/[^0-9.]/g, '')) || 0;
      const pb = parseFloat((b.price || '0').replace(/[^0-9.]/g, '')) || 0;
      return pb - pa;
    }
    return 0;
  });

  // Paginated chunk
  const totalCount = filteredProducts.length;
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE) || 1;
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedProducts = filteredProducts.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  // Checkbox interactions
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    const pageIds = paginatedProducts.map(p => p.id);
    const allSelectedOnPage = pageIds.every(id => selectedIds.includes(id));
    if (allSelectedOnPage) {
      setSelectedIds(prev => prev.filter(id => !pageIds.includes(id)));
    } else {
      setSelectedIds(prev => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  // Bulk Actions
  const handleBulkAction = async (operation: 'delete' | 'archive' | 'restore') => {
    if (selectedIds.length === 0) return;
    if (operation === 'delete' && !window.confirm(`Are you sure you want to delete ${selectedIds.length} products?`)) return;

    try {
      setLoading(true);
      await bulkOperation(selectedIds, operation);
      showToast(`Bulk ${operation} completed successfully.`, 'success');
      setSelectedIds([]);
      await fetchCatalog();
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Bulk operation failed.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Duplicate a product
  const handleDuplicate = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      setLoading(true);
      await duplicateProduct(id);
      showToast('Product duplicated successfully.', 'success');
      await fetchCatalog();
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Duplication failed.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Export selected products as CSV
  const handleExportCSV = () => {
    if (selectedIds.length === 0) {
      showToast('Select at least one product to export.', 'error');
      return;
    }
    const selectedList = products.filter(p => selectedIds.includes(p.id));
    const headers = ['ID', 'Title', 'Brand', 'Category', 'Price', 'Gender', 'Fabric', 'Pattern', 'Status'];
    const rows = selectedList.map(p => [
      p.id,
      `"${p.title.replace(/"/g, '""')}"`,
      p.brand || '',
      p.category || '',
      p.price || '',
      p.gender || '',
      p.fabric || '',
      p.pattern || '',
      p.status
    ]);

    const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `zipright_catalog_export_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#FAF9F6] dark:bg-surface-0 text-[#111111] dark:text-ink font-sans overflow-hidden relative">
      
      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-[1000] flex items-center justify-center">
          <div className="h-12 w-12 border-4 border-[#6157FF] dark:border-[#6157FF] border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}

      {/* Header Banner */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#FAF9F6]/95 dark:bg-surface-0/95 backdrop-blur-xl border-b border-black/5 dark:border-line shrink-0">
        <button 
          onClick={() => navigate('/settings')} 
          aria-label="Go back" className="flex items-center justify-center h-10 w-10 -ml-2 rounded-full transition-colors text-[#6157FF]"
        >
          <span className="material-symbols-outlined text-[24px]" aria-hidden="true">arrow_back</span>
        </button>
        <h2 className="text-lg font-bold text-[#6157FF]">Manage Products</h2>
        <button 
          onClick={() => navigate('/seller/add-product')}
          className="flex items-center justify-center h-10 w-10 -mr-2 bg-[#6157FF]/10 dark:bg-[#6157FF]/10 text-[#6157FF] dark:text-[#6157FF] rounded-full active:scale-95 transition-transform"
        >
          <span className="material-symbols-outlined">add</span>
        </button>
      </div>

      {/* Main Grid View */}
      <div className="flex-1 overflow-y-auto no-scrollbar p-6 pb-32">
        <div className="max-w-md mx-auto flex flex-col gap-6">

          {/* SEARCH BAR */}
          <div className="relative">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-[20px]">search</span>
            <input 
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title, brand or tags..."
              className="w-full h-12 bg-white dark:bg-surface-1 border border-black/5 dark:border-line rounded-2xl pl-12 pr-4 font-medium text-sm text-[#111111] dark:text-ink focus:outline-none focus:border-[#6157FF] transition-all shadow-sm"
            />
          </div>

          {/* STATUS SLIDER */}
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {(['all', 'active', 'draft', 'archived'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-4 py-2 rounded-full text-xs font-bold shrink-0 transition-all ${statusFilter === status ? 'bg-surface-0 text-ink dark:bg-white dark:text-[#111111] shadow-sm' : 'bg-white dark:bg-surface-1 text-gray-500 border border-black/5 dark:border-line'}`}
              >
                {status}
              </button>
            ))}
          </div>

          {/* ADVANCED FILTERS AND SORT */}
          <div className="grid grid-cols-3 gap-3">
            {/* Category Dropdown */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="h-10 bg-white dark:bg-surface-1 border border-black/5 dark:border-line rounded-xl px-2 text-xs font-bold focus:outline-none"
            >
              <option value="">All Categories</option>
              {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            {/* Brand Dropdown */}
            <select
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
              className="h-10 bg-white dark:bg-surface-1 border border-black/5 dark:border-line rounded-xl px-2 text-xs font-bold focus:outline-none"
            >
              <option value="">All Brands</option>
              {allBrands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>

            {/* Sort Dropdown */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="h-10 bg-white dark:bg-surface-1 border border-black/5 dark:border-line rounded-xl px-2 text-xs font-bold focus:outline-none"
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="title_asc">Name A-Z</option>
              <option value="title_desc">Name Z-A</option>
              <option value="price_asc">Price Low-High</option>
              <option value="price_desc">Price High-Low</option>
            </select>
          </div>

          {/* PRODUCT CARDS LIST */}
          <div className="flex flex-col gap-4">
            
            {paginatedProducts.length > 0 && (
              <div className="flex justify-between items-center px-2">
                <button 
                  onClick={toggleSelectAll}
                  className="text-[11px] font-bold text-gray-500 hover:text-[#6157FF] transition-colors"
                >
                  Select All on Page
                </button>
                <span className="text-[12px] text-gray-400 font-bold">
                  {startIndex + 1}-{Math.min(startIndex + ITEMS_PER_PAGE, totalCount)} of {totalCount}
                </span>
              </div>
            )}

            {paginatedProducts.length === 0 ? (
              <div className="bg-white dark:bg-surface-1 p-12 rounded-[2rem] text-center border border-black/5 dark:border-line shadow-sm">
                <span className="material-symbols-outlined text-4xl text-gray-300 mb-2">inventory_2</span>
                <h3 className="font-bold text-sm">No products found</h3>
                <p className="text-xs text-gray-400 mt-1">Try resetting your filters or add a new product.</p>
              </div>
            ) : (
              paginatedProducts.map((p) => {
                const isSelected = selectedIds.includes(p.id);
                return (
                  <div 
                    key={p.id}
                    onClick={() => navigate(`/seller/edit-product/${p.id}`)}
                    className="flex bg-white dark:bg-surface-1 rounded-[2rem] border border-black/5 dark:border-line shadow-sm p-4 gap-4 items-center cursor-pointer hover:border-[#6157FF] transition-all relative overflow-hidden group"
                  >
                    {/* Checkbox Overlay */}
                    <div 
                      onClick={(e) => { e.stopPropagation(); toggleSelect(p.id); }}
                      className="flex items-center justify-center p-2 -ml-2 shrink-0 cursor-pointer text-[#6157FF]"
                    >
                      <span className="material-symbols-outlined text-[20px]">{isSelected ? 'check_box' : 'check_box_outline_blank'}</span>
                    </div>

                    {/* Thumbnail */}
                    <div className="h-16 w-16 rounded-2xl bg-gray-50 dark:bg-black overflow-hidden border border-black/5 dark:border-line shrink-0">
                      {p.images && p.images[0] ? (
                        <img src={p.images[0]} alt={p.title} className="h-full w-full object-cover"/>
                      ) : (
                        <div className="h-full w-full flex items-center justify-center text-gray-300">
                          <span className="material-symbols-outlined">image</span>
                        </div>
                      )}
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex gap-2 items-center mb-1">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${p.status === 'active' ? 'bg-green-500/10 text-green-600' : p.status === 'draft' ? 'bg-yellow-500/10 text-yellow-600' : 'bg-gray-500/10 text-gray-500'}`}>
                          {p.status}
                        </span>
                        {p.brand && <span className="text-[12px] font-bold text-gray-400 truncate max-w-[80px]">{p.brand}</span>}
                      </div>
                      <h4 className="text-sm font-bold truncate text-[#111111] dark:text-ink leading-tight">{p.title}</h4>
                      <p className="text-xs text-gray-500 dark:text-gray-400 font-bold mt-1">{p.price || 'No Price'}</p>
                    </div>

                    {/* Duplicate button */}
                    <button 
                      onClick={(e) => handleDuplicate(e, p.id)}
                      className="absolute right-4 bottom-4 p-2 bg-black/5 dark:bg-surface-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity active:scale-90"
                    >
                      <span className="material-symbols-outlined text-xs text-gray-500">content_copy</span>
                    </button>

                  </div>
                );
              })
            )}

          </div>

          {/* PAGINATION CONTROLS */}
          {totalPages > 1 && (
            <div className="flex justify-between items-center mt-4">
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="h-10 px-4 rounded-xl border border-black/5 dark:border-line bg-white dark:bg-surface-1 font-bold text-xs disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs text-gray-400 font-bold">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="h-10 px-4 rounded-xl border border-black/5 dark:border-line bg-white dark:bg-surface-1 font-bold text-xs disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}

        </div>
      </div>

      {/* BULK OPERATIONS OVERLAY ACTION BAR */}
      {selectedIds.length > 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-md px-6 z-50">
          <div className="bg-white/95 dark:bg-surface-1/95 backdrop-blur-xl border border-black/10 dark:border-line rounded-[2rem] p-4 flex flex-col gap-3 shadow-2xl items-center text-center">
            <span className="text-xs font-bold text-[#6157FF]">{selectedIds.length} Products Selected</span>
            
            <div className="flex gap-2 w-full">
              {statusFilter !== 'archived' ? (
                <button
                  onClick={() => handleBulkAction('archive')}
                  className="flex-1 h-12 bg-gray-500/10 hover:bg-gray-500/20 text-gray-500 dark:text-gray-300 rounded-xl font-bold text-xs transition-colors"
                >
                  Archive
                </button>
              ) : (
                <button
                  onClick={() => handleBulkAction('restore')}
                  className="flex-1 h-12 bg-green-500/10 hover:bg-green-500/20 text-green-600 rounded-xl font-bold text-xs transition-colors"
                >
                  Restore
                </button>
              )}
              
              <button
                onClick={handleExportCSV}
                className="flex-1 h-12 bg-[#6157FF]/10 hover:bg-[#6157FF]/20 text-[#6157FF] dark:text-[#6157FF] rounded-xl font-bold text-xs transition-colors"
              >
                Export
              </button>
              
              <button
                onClick={() => handleBulkAction('delete')}
                className="flex-1 h-12 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-xl font-bold text-xs transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default SellerCatalog;
