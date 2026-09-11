import { CheckCircle2, TriangleAlert } from "lucide-react";
import CategoryIcon from "../common/CategoryIcon";
import { money } from "../../utils/format";
export default function BudgetCard({ category, limit, spent }) {
  const ratio = spent / limit;
  const status =
    ratio > 1 ? "Over budget" : ratio >= 0.8 ? "Near limit" : "On track";
  const tone = ratio > 1 ? "danger" : ratio >= 0.8 ? "warning" : "healthy";
  return (
    <section className={`panel budget-card ${tone}`}>
      <div className="budget-heading">
        <CategoryIcon category={category} />
        <span className="budget-status">
          {ratio >= 0.8 ? (
            <TriangleAlert size={13} />
          ) : (
            <CheckCircle2 size={13} />
          )}{" "}
          {status}
        </span>
      </div>
      <h2>{category}</h2>
      <div className="budget-amount">
        <strong>{money(spent)}</strong>
        <span>of {money(limit)}</span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={`${category} budget used`}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={Math.max(100, Math.round(ratio * 100))}
      >
        <div style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <div className="budget-footer">
        <span>
          {money(Math.abs(limit - spent))}{" "}
          {ratio > 1 ? "over budget" : "remaining"}
        </span>
        <strong>{Math.round(ratio * 100)}%</strong>
      </div>
    </section>
  );
}
