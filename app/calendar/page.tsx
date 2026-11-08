import type { Metadata } from "next";
import { Dashboard } from "../dashboard";

export const metadata: Metadata = { title: "Calendar | Deltatime" };

export default function CalendarPage() {
  return <Dashboard />;
}
