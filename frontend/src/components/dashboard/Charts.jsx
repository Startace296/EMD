import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { money, total } from "../../utils/format";
const colors = [
  "#059669",
  "#6ee7b7",
  "#a7cdb4",
  "#f0bd6b",
  "#95a5c6",
  "#c5b6dc",
  "#d1d5db",
];
export function CashFlowChart({ transactions, month }) {
  const data = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(`${month}-01T12:00:00`);
    date.setMonth(date.getMonth() - 5 + index);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const items = transactions.filter((t) => t.date.startsWith(key));
    return {
      month: date.toLocaleString("en", { month: "short" }),
      Income: total(items, "Income"),
      Expenses: total(items, "Expense"),
    };
  });
  return (
    <section className="panel cashflow">
      <div className="panel-heading">
        <div>
          <h2>Cash flow</h2>
          <p>Your income and expenses over time</p>
        </div>
        <span className="small-tag">Last 6 months</span>
      </div>
      <div className="chart-legend">
        <span>
          <i style={{ background: "#059669" }} />
          Income
        </span>
        <span>
          <i style={{ background: "#c5e9d8" }} />
          Expenses
        </span>
      </div>
      <div
        className="bar-chart"
        role="img"
        aria-label={`Six month cash flow. ${data.map((d) => `${d.month}: income ${money(d.Income)}, expenses ${money(d.Expenses)}`).join(". ")}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            barGap={5}
            margin={{ left: -15, right: 4, top: 12, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 5"
              vertical={false}
              stroke="#e9eeec"
            />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: "#84908b" }}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v / 1000000}m`}
              tick={{ fontSize: 11, fill: "#84908b" }}
            />
            <Tooltip
              formatter={(value) => money(value)}
              cursor={{ fill: "#f3f7f5" }}
              contentStyle={{ borderRadius: 12, border: "1px solid #e6ede9" }}
            />
            <Bar
              isAnimationActive={false}
              dataKey="Income"
              fill="#059669"
              radius={[4, 4, 0, 0]}
              maxBarSize={22}
            />
            <Bar
              isAnimationActive={false}
              dataKey="Expenses"
              fill="#c5e9d8"
              radius={[4, 4, 0, 0]}
              maxBarSize={22}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
export function SpendingChart({ items }) {
  const data = Object.entries(
    items
      .filter((t) => t.type === "Expense")
      .reduce(
        (all, t) => ({
          ...all,
          [t.category]: (all[t.category] || 0) + t.amount,
        }),
        {},
      ),
  )
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
  const sum = data.reduce((s, d) => s + d.value, 0);
  return (
    <section className="panel spending">
      <div className="panel-heading">
        <div>
          <h2>Where your money goes</h2>
          <p>Spending by category</p>
        </div>
      </div>
      {sum ? (
        <>
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  isAnimationActive={false}
                  data={data}
                  dataKey="value"
                  innerRadius={65}
                  outerRadius={84}
                  paddingAngle={3}
                  stroke="none"
                >
                  {data.map((d, i) => (
                    <Cell key={d.name} fill={colors[i % colors.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => money(v)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-label">
              <span>Total spent</span>
              <strong>{money(sum)}</strong>
            </div>
          </div>
          <div className="category-legend">
            {data.map((d, i) => (
              <div key={d.name}>
                <span>
                  <i style={{ background: colors[i % colors.length] }} />
                  {d.name}
                </span>
                <strong>{Math.round((d.value / sum) * 100)}%</strong>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="chart-empty">
          No expenses this month.
          <br />
          Your next transaction will appear here.
        </div>
      )}
    </section>
  );
}
