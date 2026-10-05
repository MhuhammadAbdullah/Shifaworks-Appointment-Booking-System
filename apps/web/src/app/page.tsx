import { redirect } from "next/navigation";

/**
 * There is deliberately no service listing here: customers discover services
 * on shifaworks.com and arrive directly at a service URL (/hijama-therapy, …).
 * Anyone opening the bare domain (staff bookmarking it, a stray link) lands on
 * sign-in instead of being bounced off this app entirely.
 */
export default function HomePage() {
  redirect("/login");
}
