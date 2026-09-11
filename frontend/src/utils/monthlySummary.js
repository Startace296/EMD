export function monthlySummary(transactions, month, budgets) {
  const items = transactions.filter((transaction) =>
    transaction.date.startsWith(month),
  );
  const expenses = items.filter(
    (transaction) => transaction.type === "Expense",
  );
  const income = items
    .filter((transaction) => transaction.type === "Income")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const totalExpenses = expenses.reduce(
    (sum, transaction) => sum + transaction.amount,
    0,
  );
  const categoryBudgets = budgets.map((budget) => ({
    ...budget,
    spent: expenses
      .filter((transaction) => transaction.category === budget.category)
      .reduce((sum, transaction) => sum + transaction.amount, 0),
  }));
  const budgetLimit = categoryBudgets.reduce(
    (sum, budget) => sum + budget.limit,
    0,
  );
  const budgetSpent = categoryBudgets.reduce(
    (sum, budget) => sum + budget.spent,
    0,
  );
  const outsideBudgets = Object.entries(
    expenses
      .filter(
        (transaction) =>
          !budgets.some((budget) => budget.category === transaction.category),
      )
      .reduce((totals, transaction) => {
        totals[transaction.category] =
          (totals[transaction.category] || 0) + transaction.amount;
        return totals;
      }, {}),
  ).map(([category, spent]) => ({ category, spent }));
  return {
    items,
    income,
    totalExpenses,
    categoryBudgets,
    budgetLimit,
    budgetSpent,
    remainingBudget: budgetLimit - budgetSpent,
    outsideBudgetSpent: totalExpenses - budgetSpent,
    outsideBudgets,
  };
}
