export default function MonthFilter({ month, setMonth }) {
  return (
    <label className="month-filter">
      <span className="sr-only">Select month</span>
      <input
        type="month"
        aria-label="Select month"
        value={month}
        onChange={(e) => {
          if (e.target.value) setMonth(e.target.value);
        }}
      />
    </label>
  );
}
