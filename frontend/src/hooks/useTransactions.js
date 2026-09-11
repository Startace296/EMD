import { useEffect, useRef, useState } from "react";
import { mockTransactions, categories } from "../data/mock";
const KEY = "expenseflow.transactions.v1";
function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { items: mockTransactions, warning: "" };
    const items = JSON.parse(raw);
    if (
      !Array.isArray(items) ||
      !items.every(
        (t) =>
          t &&
          typeof t.id === "string" &&
          typeof t.name === "string" &&
          Number.isFinite(t.amount) &&
          t.amount > 0 &&
          categories[t.type]?.includes(t.category) &&
          /^\d{4}-\d{2}-\d{2}$/.test(t.date) &&
          !isNaN(new Date(t.date).getTime()),
      )
    )
      throw new Error();
    return { items, warning: "" };
  } catch {
    return {
      items: mockTransactions,
      warning:
        "Saved data could not be read. Demo data is shown; adding a transaction will replace the invalid saved data.",
    };
  }
}
export function useTransactions() {
  const [initial] = useState(read);
  const [transactions, setTransactions] = useState(initial.items);
  const [toast, setToast] = useState(
    initial.warning ? { message: initial.warning, type: "error" } : null,
  );
  const timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);
  const notify = (message, type = "success") => {
    clearTimeout(timer.current);
    setToast({ message, type });
    timer.current = setTimeout(() => setToast(null), 5000);
  };
  const save = (next, message) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      setTransactions(next);
      notify(message);
      return true;
    } catch {
      notify(
        "Unable to save. Check your browser storage settings and try again.",
        "error",
      );
      return false;
    }
  };
  return {
    transactions,
    toast,
    dismissToast: () => setToast(null),
    addTransaction: (data) =>
      save(
        [{ ...data, id: crypto.randomUUID() }, ...transactions],
        "Transaction added successfully.",
      ),
    deleteTransaction: (id) =>
      save(
        transactions.filter((t) => t.id !== id),
        "Transaction deleted successfully.",
      ),
  };
}
