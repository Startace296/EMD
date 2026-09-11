import { Link } from "react-router-dom";
import {
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  ChartPie,
  MoveRight,
  Sparkles,
} from "lucide-react";
import PageHeader from "../components/common/PageHeader";
import MonthFilter from "../components/common/MonthFilter";
import StatCard from "../components/dashboard/StatCard";
import { CashFlowChart, SpendingChart } from "../components/dashboard/Charts";
import TransactionTable from "../components/transactions/TransactionTable";
import { EmptyState } from "../components/common/States";
import { budgets } from "../data/mock";
import { monthlySummary } from "../utils/monthlySummary";
export default function Dashboard({ transactions, month, setMonth, onAdd }) {
  const {
    items,
    income,
    totalExpenses: expenses,
    remainingBudget,
  } = monthlySummary(transactions, month, budgets);
  return (
    <>
      <PageHeader
        eyebrow="YOUR MONEY, AT A GLANCE"
        title="Welcome back, Alex"
        description="A little clarity for your everyday finances."
        onAdd={onAdd}
      >
        <MonthFilter month={month} setMonth={setMonth} />
      </PageHeader>
      <div className="stats-grid">
        <StatCard
          title="Total Balance"
          value={income - expenses}
          icon={Wallet}
          description="Net cash flow this month"
          featured
        />
        <StatCard
          title="Total Income"
          value={income}
          icon={ArrowDownLeft}
          description={`${items.filter((t) => t.type === "Income").length} income transactions`}
        />
        <StatCard
          title="Total Expenses"
          value={expenses}
          icon={ArrowUpRight}
          description={`${items.filter((t) => t.type === "Expense").length} expense transactions`}
        />
        <StatCard
          title="Remaining Budget"
          value={remainingBudget}
          icon={ChartPie}
          description={`${budgets.length} categories · excludes Rent & Other`}
        />
      </div>
      <div className="charts-grid">
        <CashFlowChart transactions={transactions} month={month} />
        <SpendingChart items={items} />
      </div>
      <section className="panel recent-panel">
        <div className="panel-heading">
          <div>
            <h2>Recent transactions</h2>
            <p>The latest little moves in your money</p>
          </div>
          <Link to="/transactions" className="text-link">
            View all <MoveRight size={16} />
          </Link>
        </div>
        {items.length ? (
          <TransactionTable
            items={[...items]
              .sort((a, b) => b.date.localeCompare(a.date))
              .slice(0, 5)}
            compact
          />
        ) : (
          <EmptyState onAdd={onAdd} />
        )}
      </section>
      <div className="insight">
        <Sparkles size={18} />
        <p>
          <strong>Small habits, lasting impact.</strong> Check in on your
          spending regularly to keep your goals within reach.
        </p>
        <Link to="/budgets">
          See budgets <MoveRight size={16} />
        </Link>
      </div>
    </>
  );
}
