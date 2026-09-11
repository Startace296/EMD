import { currentMonth } from "../utils/format";
export const categories = {
  Income: ["Salary", "Freelance", "Other Income"],
  Expense: [
    "Food",
    "Transportation",
    "Rent",
    "Shopping",
    "Entertainment",
    "Education",
    "Other",
  ],
};
export const budgets = [
  { category: "Food", limit: 2000000 },
  { category: "Transportation", limit: 800000 },
  { category: "Shopping", limit: 1500000 },
  { category: "Entertainment", limit: 600000 },
  { category: "Education", limit: 1000000 },
];
const rows = [
  ["Monthly salary", 15000000, "Income", "Salary", 1],
  ["Apartment rent", 3000000, "Expense", "Rent", 2],
  ["Weekly groceries", 850000, "Expense", "Food", 3],
  ["Coffee with friends", 125000, "Expense", "Food", 4],
  ["September bus pass", 300000, "Expense", "Transportation", 5],
  ["Movie night & dinner", 500000, "Expense", "Entertainment", 6],
  ["New semester essentials", 1650000, "Expense", "Shopping", 7],
  ["Online design course", 450000, "Expense", "Education", 8],
  ["Website freelance project", 2500000, "Income", "Freelance", 9],
];
export const mockTransactions = rows.map(
  ([name, amount, type, category, day], i) => ({
    id: `seed-${i}`,
    name: name === "September bus pass" ? "Monthly bus pass" : name,
    amount,
    type,
    category,
    date: `${currentMonth}-${String(Math.min(day, new Date().getDate())).padStart(2, "0")}`,
    note: "",
  }),
);
for (let offset = 1; offset <= 5; offset++) {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - offset);
  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  mockTransactions.push(
    {
      id: `history-income-${offset}`,
      name: "Monthly salary",
      amount: 15000000,
      type: "Income",
      category: "Salary",
      date: `${month}-01`,
      note: "",
    },
    {
      id: `history-expense-${offset}`,
      name: "Monthly living expenses",
      amount: 6500000 + offset * 420000,
      type: "Expense",
      category: "Other",
      date: `${month}-15`,
      note: "",
    },
  );
}
