import {
  Utensils,
  Bus,
  House,
  ShoppingBag,
  Clapperboard,
  GraduationCap,
  BriefcaseBusiness,
  Laptop,
  ArrowDownLeft,
  Shapes,
} from "lucide-react";
const icons = {
  Food: Utensils,
  Transportation: Bus,
  Rent: House,
  Shopping: ShoppingBag,
  Entertainment: Clapperboard,
  Education: GraduationCap,
  Salary: BriefcaseBusiness,
  Freelance: Laptop,
  "Other Income": ArrowDownLeft,
};
export default function CategoryIcon({ category }) {
  const Icon = icons[category] || Shapes;
  return (
    <span
      className={`category-icon category-${category.toLowerCase().replaceAll(" ", "-")}`}
    >
      <Icon size={19} aria-hidden="true" />
    </span>
  );
}
