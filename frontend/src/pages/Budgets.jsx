import { ChartPie, Target, Wallet } from "lucide-react";
import PageHeader from "../components/common/PageHeader";
import MonthFilter from "../components/common/MonthFilter";
import BudgetCard from "../components/budgets/BudgetCard";
import { budgets } from "../data/mock";
import { money, monthLabel } from "../utils/format";
import { monthlySummary } from "../utils/monthlySummary";
export default function Budgets({ transactions, month, setMonth }) {
  const {
    categoryBudgets: data,
    budgetLimit: limit,
    budgetSpent: spent,
    remainingBudget,
    totalExpenses,
    outsideBudgetSpent,
    outsideBudgets,
  } = monthlySummary(transactions, month, budgets);
  return (
    <>
      <PageHeader
        eyebrow="MAKE ROOM FOR WHAT MATTERS"
        title="Budgets"
        description="A thoughtful plan for your everyday spending."
      >
        <MonthFilter month={month} setMonth={setMonth} />
      </PageHeader>
      <section className="budget-overview">
        <div>
          <span className="eyebrow">{monthLabel(month).toUpperCase()}</span>
          <h2>Your monthly game plan</h2>
          <p>Small boundaries. More freedom to do what you love.</p>
        </div>
        <div className="overview-stats">
          {[
            { label: "Total budget", value: limit, icon: Target },
            { label: "Spent within budgets", value: spent, icon: ChartPie },
            { label: "Remaining Budget", value: remainingBudget, icon: Wallet },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label}>
              <span>
                <Icon size={15} />
                {label}
              </span>
              <strong>{money(value)}</strong>
            </div>
          ))}
        </div>
      </section>
      <section
        className="panel spending-breakdown"
        aria-labelledby="spending-breakdown-title"
      >
        <h2 id="spending-breakdown-title">Monthly spending breakdown</h2>
        <p>
          All expenses for {monthLabel(month)}, matching Total Expenses on
          Dashboard.
        </p>
        <dl>
          <div>
            <dt>Spent within budgets</dt>
            <dd>{money(spent)}</dd>
          </div>
          <div>
            <dt>Outside budgets</dt>
            <dd>{money(outsideBudgetSpent)}</dd>
          </div>
          <div className="breakdown-total">
            <dt>Total Expenses</dt>
            <dd>{money(totalExpenses)}</dd>
          </div>
        </dl>
        <p>
          {outsideBudgets.length
            ? `Outside budgets: ${outsideBudgets.map((item) => `${item.category} (${money(item.spent)})`).join(", ")}. These expenses do not reduce Remaining Budget.`
            : "No spending outside your budget categories this month."}
        </p>
      </section>
      <div className="section-title">
        <h2>Category budgets</h2>
        <span>{data.length} monthly budgets</span>
      </div>
      <div className="budgets-grid">
        {data.map((b) => (
          <BudgetCard key={b.category} {...b} />
        ))}
      </div>
      <p className="storage-note">
        Budgets repeat each month. Rent and uncategorized spending are tracked
        in Transactions and excluded from this plan.
      </p>
    </>
  );
}
