import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button, Select, SelectItem, Text } from '@tremor/react';
import './Pagination.css';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

export function Pagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
}: PaginationProps) {
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  const getVisiblePages = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible + 2) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);

      if (currentPage > 3) {
        pages.push('...');
      }

      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (currentPage < totalPages - 2) {
        pages.push('...');
      }

      pages.push(totalPages);
    }

    return pages;
  };

  if (totalItems === 0) return null;

  return (
    <div className="pagination">
      <div className="pagination-info">
        <Text>
          Showing <span className="pagination-highlight">{startItem}</span> to{' '}
          <span className="pagination-highlight">{endItem}</span> of{' '}
          <span className="pagination-highlight">{totalItems}</span> results
        </Text>

        {onPageSizeChange && (
          <div className="pagination-size">
            <Text>Show</Text>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => onPageSizeChange(Number(v))}
              className="pagination-size-select"
            >
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </Select>
          </div>
        )}
      </div>

      <div className="pagination-controls">
        <Button
          variant="secondary"
          size="xs"
          icon={ChevronsLeft}
          onClick={() => onPageChange(1)}
          disabled={currentPage === 1}
          className="pagination-btn"
        />
        <Button
          variant="secondary"
          size="xs"
          icon={ChevronLeft}
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className="pagination-btn"
        />

        <div className="pagination-pages">
          {getVisiblePages().map((page, index) =>
            typeof page === 'number' ? (
              <button
                key={index}
                onClick={() => onPageChange(page)}
                className={`pagination-page ${currentPage === page ? 'active' : ''}`}
              >
                {page}
              </button>
            ) : (
              <span key={index} className="pagination-ellipsis">
                {page}
              </span>
            )
          )}
        </div>

        <Button
          variant="secondary"
          size="xs"
          icon={ChevronRight}
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className="pagination-btn"
        />
        <Button
          variant="secondary"
          size="xs"
          icon={ChevronsRight}
          onClick={() => onPageChange(totalPages)}
          disabled={currentPage === totalPages}
          className="pagination-btn"
        />
      </div>
    </div>
  );
}
