import { Trash2 } from "lucide-react";
import CategoryIcon from "../common/CategoryIcon";
import { money, prettyDate } from "../../utils/format";
export default function TransactionTable({ items, onDelete, compact = false }) {
  return (
    <div className={`transaction-list ${compact ? "compact" : ""}`}>
      <table>
        <thead>
          <tr>
            <th>Transaction</th>
            <th>Category</th>
            <th>Date</th>
            {!compact && <th>Type</th>}
            <th className="align-right">Amount</th>
            {onDelete && (
              <th>
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id}>
              <td>
                <div className="transaction-name">
                  <CategoryIcon category={t.category} />
                  <div>
                    <strong>{t.name}</strong>
                    <span className="mobile-detail">
                      {!compact && `${t.type} · `}
                      {t.category} · {prettyDate(t.date)}
                    </span>
                  </div>
                </div>
              </td>
              <td>
                <span className="category-pill">{t.category}</span>
              </td>
              <td className="date-cell">{prettyDate(t.date)}</td>
              {!compact && (
                <td>
                  <span className={`type-pill ${t.type.toLowerCase()}`}>
                    {t.type}
                  </span>
                </td>
              )}
              <td
                className={`amount align-right ${t.type === "Income" ? "positive" : ""}`}
              >
                <span className="sr-only">{t.type} </span>
                {t.type === "Income" ? "+" : "−"}
                {money(t.amount)}
              </td>
              {onDelete && (
                <td className="delete-cell">
                  <button
                    className="icon-button delete-button"
                    aria-label={`Delete ${t.name}`}
                    onClick={() => onDelete(t.id)}
                  >
                    <Trash2 size={17} />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
