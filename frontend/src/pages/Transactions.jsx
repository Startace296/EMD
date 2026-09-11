import { useState } from "react";
import { Search, TriangleAlert, SlidersHorizontal } from "lucide-react";
import PageHeader from "../components/common/PageHeader";
import TransactionTable from "../components/transactions/TransactionTable";
import {
  LoadingState,
  EmptyState,
  ErrorState,
} from "../components/common/States";
import { useLoadingState } from "../hooks/useLoadingState";
import { categories } from "../data/mock";
export default function Transactions({ transactions, onAdd, onDelete }) {
  const [query, setQuery] = useState(""),
    [type, setType] = useState(""),
    [category, setCategory] = useState("");
  const { status, retry, simulateError } = useLoadingState();
  const options = type ? categories[type] : Object.values(categories).flat();
  const items = transactions
    .filter(
      (t) =>
        t.name.toLowerCase().includes(query.toLowerCase().trim()) &&
        (!type || t.type === type) &&
        (!category || t.category === category),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const clear = () => {
    setQuery("");
    setType("");
    setCategory("");
  };
  return (
    <>
      <PageHeader
        eyebrow="EVERY TRANSACTION TELLS A STORY"
        title="Transactions"
        description="Keep track of what comes in and what goes out."
        onAdd={onAdd}
      />
      <section className="panel">
        <div className="filters">
          <label className="search-input">
            <Search size={18} />
            <input
              aria-label="Search transactions"
              placeholder="Search transactions…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">Transaction type</span>
            <select
              aria-label="Filter by type"
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setCategory("");
              }}
            >
              <option value="">All types</option>
              <option>Income</option>
              <option>Expense</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Category</span>
            <select
              aria-label="Filter by category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {options.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {(query || type || category) && (
            <button className="text-link" onClick={clear}>
              Clear filters
            </button>
          )}
        </div>
        <div className="list-summary">
          <span>
            <SlidersHorizontal size={14} />
            {items.length} transactions{" "}
            <span className="muted">· All dates</span>
          </span>
          <button
            className="simulate-button"
            onClick={simulateError}
            disabled={status === "error"}
          >
            <TriangleAlert size={13} />
            Simulate error
          </button>
        </div>
        {status === "loading" ? (
          <LoadingState />
        ) : status === "error" ? (
          <ErrorState onRetry={retry} />
        ) : items.length ? (
          <TransactionTable items={items} onDelete={onDelete} />
        ) : (
          <EmptyState
            filtered={!!(query || type || category)}
            onAdd={onAdd}
            onClear={clear}
          />
        )}
      </section>
      <p className="storage-note">
        Your transactions are saved in this browser. A little peace of mind,
        automatically.
      </p>
    </>
  );
}
