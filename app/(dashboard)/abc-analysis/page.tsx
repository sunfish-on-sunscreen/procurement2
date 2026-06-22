import { redirect } from "next/navigation";

// ABC Analysis was merged into Spend Overview (Pareto/ABC card). This route
// redirects to preserve any existing bookmarks/links.
export default function AbcAnalysisPage() {
  redirect("/spend-overview");
}
