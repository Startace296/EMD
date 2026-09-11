import { useEffect, useState } from "react";
export function useLoadingState() {
  const [status, setStatus] = useState("loading");
  useEffect(() => {
    if (status !== "loading") return;
    const timer = setTimeout(() => setStatus("success"), 700);
    return () => clearTimeout(timer);
  }, [status]);
  return {
    status,
    retry: () => setStatus("loading"),
    simulateError: () => setStatus("error"),
  };
}
