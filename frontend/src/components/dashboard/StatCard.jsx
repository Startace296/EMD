import { ArrowUpRight } from "lucide-react";
import { money } from "../../utils/format";
export default function StatCard({
  title,
  value,
  icon: Icon,
  description,
  featured,
}) {
  return (
    <section className={`stat-card ${featured ? "featured" : ""}`}>
      <div className="stat-heading">
        <span>{title}</span>
        <span className="stat-icon">
          <Icon size={19} />
        </span>
      </div>
      <div className="stat-value">{money(value)}</div>
      <div className="stat-caption">
        <ArrowUpRight size={14} />
        {description}
      </div>
      {featured && <div className="card-orbit" />}
    </section>
  );
}
