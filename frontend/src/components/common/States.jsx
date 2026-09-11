import { SearchX, TriangleAlert, Plus, RotateCcw } from "lucide-react";
export function LoadingState() {
  return (
    <div
      className="skeleton-list"
      role="status"
      aria-label="Loading transactions"
    >
      <span className="sr-only">Loading transactions</span>
      {Array.from({ length: 5 }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <div className="skeleton square" />
          <div className="skeleton line" />
          <div className="skeleton short" />
        </div>
      ))}
    </div>
  );
}
export function EmptyState({ filtered, onAdd, onClear }) {
  return (
    <div className="state-card">
      <span className="state-icon">
        <SearchX size={28} />
      </span>
      <h3>
        {filtered ? "No matching transactions" : "Your fresh start begins here"}
      </h3>
      <p>
        {filtered
          ? "Try another search or reset your filters to see your activity."
          : "Add your first transaction and start getting to know your money."}
      </p>
      <button className="button primary" onClick={filtered ? onClear : onAdd}>
        {filtered ? <RotateCcw size={16} /> : <Plus size={16} />}{" "}
        {filtered ? "Clear filters" : "Add Transaction"}
      </button>
    </div>
  );
}
export function ErrorState({ onRetry }) {
  return (
    <div className="state-card error-card" role="alert">
      <span className="state-icon">
        <TriangleAlert size={28} />
      </span>
      <h3>Something went wrong</h3>
      <p>
        We couldn’t load your transactions. Your saved data is safe. Give it
        another try.
      </p>
      <button className="button primary" onClick={onRetry}>
        <RotateCcw size={16} />
        Try again
      </button>
    </div>
  );
}
