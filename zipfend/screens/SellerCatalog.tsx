import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import { listProducts, bulkOperation, duplicateProduct, SellerProduct } from '../services/ziprightApi';
import {
  AppBar,
  Button,
  IconButton,
  Eyebrow,
  EmptyState,
  SegmentedControl,
  Spinner,
  StaggerList,
  StaggerItem,
} from '../components/ui';

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

  const statusTone = (status: string) =>
    status === 'active'
      ? 'bg-success-soft text-success'
      : status === 'draft'
        ? 'bg-warning-soft text-warning'
        : 'bg-surface-2 text-ink-faint';

  return (
    <div className="relative flex flex-col min-h-screen min-h-dvh w-full bg-surface-0 text-ink overflow-x-hidden">

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-scrim backdrop-blur-sm z-[1000] flex items-center justify-center">
          <Spinner size={40} className="text-brand" />
        </div>
      )}

      <AppBar
        title="Catalogue"
        onBack={() => navigate('/settings')}
        trailing={
          <IconButton
            icon="add"
            aria-label="Add product"
            variant="ghost"
            size="sm"
            onClick={() => navigate('/seller/add-product')}
          />
        }
      />

      {/* Main scroll region */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-6 pt-6 pb-40">
        <div className="max-w-md mx-auto flex flex-col gap-7">

          {/* Editorial opener */}
          <div>
            <Eyebrow className="mb-2">Merchant tools</Eyebrow>
            <h1 className="font-display text-[32px] leading-[1.05] font-light text-ink">
              Manage your <em className="font-medium">pieces.</em>
            </h1>
          </div>

          {/* SEARCH BAR */}
          <div className="relative">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint text-[19px] pointer-events-none" aria-hidden="true">search</span>
            <input
              type="search"
              aria-label="Search products"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title, brand or tags…"
              className="w-full h-11 bg-surface-1 border border-line rounded-full pl-11 pr-10 text-[14px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 transition-[border-color,box-shadow]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full active:scale-90"
              >
                <span className="material-symbols-outlined text-ink-faint text-[17px]" aria-hidden="true">close</span>
              </button>
            )}
          </div>

          {/* STATUS FILTER */}
          <SegmentedControl
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'draft', label: 'Draft' },
              { value: 'archived', label: 'Archived' },
            ]}
          />

          {/* ADVANCED FILTERS AND SORT */}
          <div className="grid grid-cols-3 gap-2.5">
            {/* Category Dropdown */}
            <select
              aria-label="Filter by category"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="h-10 bg-surface-1 border border-line rounded-full px-3 text-[12px] font-medium text-ink focus:outline-none focus:border-ink transition-colors"
            >
              <option value="">All Categories</option>
              {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            {/* Brand Dropdown */}
            <select
              aria-label="Filter by brand"
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
              className="h-10 bg-surface-1 border border-line rounded-full px-3 text-[12px] font-medium text-ink focus:outline-none focus:border-ink transition-colors"
            >
              <option value="">All Brands</option>
              {allBrands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>

            {/* Sort Dropdown */}
            <select
              aria-label="Sort products"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="h-10 bg-surface-1 border border-line rounded-full px-3 text-[12px] font-medium text-ink focus:outline-none focus:border-ink transition-colors"
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
              <div className="flex justify-between items-center px-1">
                <button
                  onClick={toggleSelectAll}
                  className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint hover:text-ink transition-colors"
                >
                  Select all on page
                </button>
                <span className="text-[11px] font-medium text-ink-faint tabular-nums">
                  {startIndex + 1}-{Math.min(startIndex + ITEMS_PER_PAGE, totalCount)} of {totalCount}
                </span>
              </div>
            )}

            {paginatedProducts.length === 0 ? (
              <EmptyState
                icon="inventory_2"
                title="No products found"
                description="Try resetting your filters or add a new product."
              />
            ) : (
              <StaggerList className="flex flex-col gap-4" delay={0.04}>
                {paginatedProducts.map((p) => {
                  const isSelected = selectedIds.includes(p.id);
                  return (
                    <StaggerItem key={p.id}>
                      <div
                        onClick={() => navigate(`/seller/edit-product/${p.id}`)}
                        className={`group relative flex items-center gap-4 p-4 rounded-card bg-surface-1 border transition-colors cursor-pointer ${isSelected ? 'border-brand' : 'border-line hover:border-line-strong'}`}
                      >
                        {/* Checkbox */}
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleSelect(p.id); }}
                          aria-label={isSelected ? `Deselect ${p.title}` : `Select ${p.title}`}
                          className="flex items-center justify-center -ml-1 shrink-0 text-brand"
                        >
                          <span className="material-symbols-outlined text-[22px]" aria-hidden="true" style={isSelected ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                            {isSelected ? 'check_box' : 'check_box_outline_blank'}
                          </span>
                        </button>

                        {/* Thumbnail */}
                        <div className="h-16 w-16 rounded-xl bg-surface-2 overflow-hidden border border-line shrink-0">
                          {p.images && p.images[0] ? (
                            <img src={p.images[0]} alt={p.title} className="h-full w-full object-cover" />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center text-ink-faint">
                              <span className="material-symbols-outlined" aria-hidden="true">image</span>
                            </div>
                          )}
                        </div>

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex gap-2 items-center mb-1.5">
                            <span className={`text-[9.5px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full ${statusTone(p.status)}`}>
                              {p.status}
                            </span>
                            {p.brand && <span className="text-[11px] font-medium text-ink-faint truncate max-w-[80px]">{p.brand}</span>}
                          </div>
                          <h4 className="font-display text-[15px] font-medium truncate text-ink leading-tight">{p.title}</h4>
                          <p className="text-[12px] text-ink-soft font-medium mt-1">{p.price || 'No Price'}</p>
                        </div>

                        {/* Duplicate button */}
                        <button
                          onClick={(e) => handleDuplicate(e, p.id)}
                          aria-label={`Duplicate ${p.title}`}
                          className="absolute right-4 bottom-4 p-2 bg-surface-2 border border-line rounded-full opacity-0 group-hover:opacity-100 transition-opacity active:scale-90"
                        >
                          <span className="material-symbols-outlined text-[15px] text-ink-soft" aria-hidden="true">content_copy</span>
                        </button>
                      </div>
                    </StaggerItem>
                  );
                })}
              </StaggerList>
            )}

          </div>

          {/* PAGINATION CONTROLS */}
          {totalPages > 1 && (
            <div className="flex justify-between items-center mt-2">
              <Button
                variant="outline"
                size="sm"
                icon="chevron_left"
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <span className="text-[11px] font-medium text-ink-faint tabular-nums">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                trailingIcon="chevron_right"
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          )}

        </div>
      </div>

      {/* BULK OPERATIONS ACTION BAR */}
      {selectedIds.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 w-full px-6 pb-8 pt-5 bg-gradient-to-t from-surface-0 via-surface-0/95 to-transparent z-50 phone-fixed-bottom">
          <div className="rounded-card bg-surface-1 border border-line shadow-float p-4 flex flex-col gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-brand text-center">
              {selectedIds.length} Selected
            </p>
            <div className="flex gap-2">
              {statusFilter !== 'archived' ? (
                <Button variant="secondary" size="sm" fullWidth onClick={() => handleBulkAction('archive')}>
                  Archive
                </Button>
              ) : (
                <Button variant="secondary" size="sm" fullWidth icon="restore" onClick={() => handleBulkAction('restore')}>
                  Restore
                </Button>
              )}

              <Button variant="outline" size="sm" fullWidth onClick={handleExportCSV}>
                Export
              </Button>

              <Button variant="danger" size="sm" fullWidth onClick={() => handleBulkAction('delete')}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default SellerCatalog;
