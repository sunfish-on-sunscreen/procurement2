import { redirect } from "next/navigation";

// The dashboard root now lives at /spend-overview (renamed from "Overview").
export default function Home() {
  redirect("/spend-overview");
}
