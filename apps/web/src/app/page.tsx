import { redirect } from "next/navigation";
import { publicEnv } from "@/lib/env";

/**
 * There is deliberately no service listing here: customers discover services
 * on shifaworks.com and arrive directly at a service URL (/hijama-therapy, …).
 * Anyone opening the bare domain is sent back to the main website.
 */
export default function HomePage() {
  redirect(publicEnv.NEXT_PUBLIC_WEBSITE_URL);
}
