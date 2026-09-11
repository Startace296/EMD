import { Plus } from "lucide-react";
export default function PageHeader({
  eyebrow,
  title,
  description,
  onAdd,
  children,
}) {
  return (
    <div className="page-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="header-actions">
        {children}
        {onAdd && (
          <button className="button primary" onClick={onAdd}>
            <Plus size={18} />
            Add Transaction
          </button>
        )}
      </div>
    </div>
  );
}
