import { CheckCircle2, TriangleAlert, X } from "lucide-react";
export default function Toast({ toast, dismiss }) {
  if (!toast) return null;
  const Icon = toast.type === "error" ? TriangleAlert : CheckCircle2;
  return (
    <div
      className={`toast ${toast.type}`}
      role={toast.type === "error" ? "alert" : "status"}
    >
      <Icon size={21} />
      <span>{toast.message}</span>
      <button
        className="icon-button"
        onClick={dismiss}
        aria-label="Dismiss notification"
      >
        <X size={17} />
      </button>
    </div>
  );
}
