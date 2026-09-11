import { useEffect, useRef, useState } from "react";
import { X, Plus, LoaderCircle } from "lucide-react";
import { categories } from "../../data/mock";
import { localDate } from "../../utils/format";
const blank = () => ({
  name: "",
  amount: "",
  type: "Expense",
  category: "",
  date: localDate(),
  note: "",
});
export default function TransactionForm({ onClose, onSave }) {
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const dialog = useRef();
  const timer = useRef();
  const submitting = useRef(false);
  const returnFocus = useRef(document.activeElement);
  useEffect(() => {
    const previous = returnFocus.current;
    const dialogNode = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current.querySelector("input")?.focus();
    const handle = (e) => {
      if (e.key === "Escape" && !submitting.current) onClose();
      if (e.key === "Tab") {
        const nodes = Array.from(
          dialog.current.querySelectorAll("button,input,select,textarea"),
        ).filter((n) => !n.disabled);
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      clearTimeout(timer.current);
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handle);
      requestAnimationFrame(() => {
        if (!dialogNode.isConnected && previous?.isConnected)
          previous.focus();
      });
    };
  }, [onClose]);
  const update = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({
      ...f,
      [name]: value,
      ...(name === "type" ? { category: "" } : {}),
    }));
    setErrors((err) => ({
      ...err,
      [name]: undefined,
      ...(name === "type" ? { category: undefined } : {}),
    }));
  };
  const submit = (e) => {
    e.preventDefault();
    if (submitting.current) return;
    const next = {};
    if (!form.name.trim()) next.name = "Please enter a transaction name.";
    if (!Number.isFinite(Number(form.amount)) || Number(form.amount) <= 0)
      next.amount = "Enter an amount greater than 0.";
    if (!categories[form.type]) next.type = "Please select a transaction type.";
    if (!categories[form.type]?.includes(form.category))
      next.category = "Please select a category.";
    if (!form.date || isNaN(new Date(form.date).getTime()))
      next.date = "Please select a valid date.";
    setErrors(next);
    if (Object.keys(next).length) {
      setTimeout(
        () => dialog.current.querySelector('[aria-invalid="true"]')?.focus(),
        0,
      );
      return;
    }
    submitting.current = true;
    setBusy(true);
    timer.current = setTimeout(() => {
      if (
        onSave({
          ...form,
          name: form.name.trim(),
          note: form.note.trim(),
          amount: Number(form.amount),
        })
      ) {
        setForm(blank());
        onClose();
      } else {
        setBusy(false);
        submitting.current = false;
      }
    }, 650);
  };
  const attrs = (name) => ({
    id: name,
    name,
    value: form[name],
    onChange: update,
    "aria-invalid": !!errors[name],
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });
  const error = (name) =>
    errors[name] && (
      <span id={`${name}-error`} className="field-error">
        {errors[name]}
      </span>
    );
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={dialog}
      >
        <div className="modal-header">
          <span className="state-icon">
            <Plus />
          </span>
          <button
            className="icon-button"
            disabled={busy}
            onClick={onClose}
            aria-label="Close transaction form"
          >
            <X />
          </button>
        </div>
        <h2 id="modal-title">Add a transaction</h2>
        <p className="muted">
          Every little detail brings your finances into focus.
        </p>
        <form onSubmit={submit} noValidate>
          <fieldset disabled={busy}>
            <label htmlFor="name">
              Transaction name <span>*</span>
            </label>
            <input
              {...attrs("name")}
              placeholder="e.g. Weekly groceries"
              maxLength={100}
            />
            {error("name")}
            <div className="form-grid">
              <div>
                <label htmlFor="amount">
                  Amount (VND) <span>*</span>
                </label>
                <input
                  {...attrs("amount")}
                  type="number"
                  min="1"
                  step="any"
                  inputMode="decimal"
                  placeholder="0"
                />
                {error("amount")}
              </div>
              <div>
                <label htmlFor="type">
                  Type <span>*</span>
                </label>
                <select {...attrs("type")}>
                  <option value="">Select type</option>
                  <option>Expense</option>
                  <option>Income</option>
                </select>
                {error("type")}
              </div>
              <div>
                <label htmlFor="category">
                  Category <span>*</span>
                </label>
                <select {...attrs("category")}>
                  <option value="">Select category</option>
                  {(categories[form.type] || []).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                {error("category")}
              </div>
              <div>
                <label htmlFor="date">
                  Date <span>*</span>
                </label>
                <input {...attrs("date")} type="date" />
                {error("date")}
              </div>
            </div>
            <label htmlFor="note">
              Note <small>(optional)</small>
            </label>
            <textarea
              {...attrs("note")}
              rows={3}
              maxLength={500}
              placeholder="Anything you’d like to remember…"
            />
          </fieldset>
          <div className="modal-footer">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Plus size={17} />
              )}{" "}
              {busy ? "Saving transaction…" : "Add Transaction"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
