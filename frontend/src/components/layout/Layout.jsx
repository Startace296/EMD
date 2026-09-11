import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  Wallet,
  LayoutDashboard,
  ArrowLeftRight,
  ChartPie,
  Menu,
  X,
  ChevronDown,
  Leaf,
  ArrowUpRight,
} from "lucide-react";
const links = [
  { to: "/", name: "Dashboard", icon: LayoutDashboard },
  { to: "/transactions", name: "Transactions", icon: ArrowLeftRight },
  { to: "/budgets", name: "Budgets", icon: ChartPie },
];
export default function Layout() {
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(
    () => window.matchMedia("(min-width: 1024px)").matches,
  );
  const location = useLocation();
  const pageName =
    links.find((link) => link.to === location.pathname)?.name ||
    "Page not found";
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => {
      setDesktop(media.matches);
      setOpen(false);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  return (
    <div className="app-shell">
      <header className="mobile-header">
        <Link to="/" className="brand" onClick={() => setOpen(false)}>
          <span className="brand-icon">
            <Wallet size={22} />
          </span>
          ExpenseFlow<span className="brand-dot">.</span>
        </Link>
        <button
          className="icon-button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen(!open)}
        >
          {open ? <X /> : <Menu />}
        </button>
      </header>
      {open && (
        <button
          className="nav-overlay"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        id="sidebar"
        inert={!desktop && !open}
        className={`sidebar ${open ? "is-open" : ""}`}
      >
        <Link to="/" className="brand">
          <span className="brand-icon">
            <Wallet size={23} />
          </span>
          ExpenseFlow<span className="brand-dot">.</span>
        </Link>
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <nav aria-label="Main navigation">
          {links.map(({ to, name, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `nav-link ${isActive ? "active" : ""}`
              }
            >
              <Icon size={20} />
              {name}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="mindful-card">
            <span className="leaf-icon">
              <Leaf size={20} />
            </span>
            <h3>Little steps. Big goals.</h3>
            <p>
              A little awareness today.
              <br />A brighter financial tomorrow.
            </p>
            <NavLink to="/budgets" onClick={() => setOpen(false)}>
              Explore your budgets <ArrowUpRight size={15} />
            </NavLink>
          </div>
          <div className="user-profile">
            <div className="avatar">AL</div>
            <div>
              <strong>Alex Le</strong>
              <span>Personal account</span>
            </div>
            <ChevronDown size={16} />
          </div>
        </div>
      </aside>
      <main id="main-content" className="main" inert={open && !desktop}>
        <div className="topbar">
          <span>
            My workspace <span className="slash">/</span>{" "}
            <strong>{pageName}</strong>
          </span>
          <span className="demo-badge">
            <span /> Local demo account
          </span>
        </div>
        <Outlet />
        <footer>
          Made for a more mindful relationship with money.
          <span>ExpenseFlow © {new Date().getFullYear()}</span>
        </footer>
      </main>
    </div>
  );
}
