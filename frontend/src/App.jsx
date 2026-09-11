import { useCallback, useState } from "react";
import { Routes, Route, Link } from "react-router-dom";
import Layout from "./components/layout/Layout";
import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Budgets from "./pages/Budgets";
import TransactionForm from "./components/transactions/TransactionForm";
import Toast from "./components/common/Toast";
import { useTransactions } from "./hooks/useTransactions";
import { currentMonth } from "./utils/format";
export default function App() {
  const store = useTransactions();
  const [month, setMonth] = useState(currentMonth);
  const [formOpen, setFormOpen] = useState(false);
  const close = useCallback(() => setFormOpen(false), []);
  const shared = {
    transactions: store.transactions,
    month,
    setMonth,
    onAdd: () => setFormOpen(true),
  };
  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard {...shared} />} />
          <Route
            path="transactions"
            element={
              <Transactions {...shared} onDelete={store.deleteTransaction} />
            }
          />
          <Route path="budgets" element={<Budgets {...shared} />} />
          <Route
            path="*"
            element={
              <div className="state-card">
                <h1>Page not found</h1>
                <p>Let’s get back to your finances.</p>
                <Link className="button primary" to="/">
                  Back to Dashboard
                </Link>
              </div>
            }
          />
        </Route>
      </Routes>
      {formOpen && (
        <TransactionForm onClose={close} onSave={store.addTransaction} />
      )}
      <Toast toast={store.toast} dismiss={store.dismissToast} />
    </>
  );
}
