"use client";

import { useQuery } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface ReadyResponse {
  status: "ok";
  checks: Record<string, "ok" | "down" | "disabled">;
}

/** Verifies the web → API → database wiring end to end. */
export function HealthStatus() {
  const { data, error, isPending } = useQuery({
    queryKey: ["health", "ready"],
    queryFn: ({ signal }) => apiRequest<ReadyResponse>("/health/ready", { signal }).then((r) => r.data),
  });

  const state = isPending ? "checking" : error ? "down" : "ok";
  return (
    <div className="rounded-lg border bg-card p-4 text-sm">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "size-2.5 rounded-full",
            state === "ok" && "bg-emerald-500",
            state === "down" && "bg-destructive",
            state === "checking" && "animate-pulse bg-muted-foreground",
          )}
        />
        <span className="font-medium">
          API {state === "checking" ? "checking…" : state === "ok" ? "connected" : "unavailable"}
        </span>
      </div>
      {data && (
        <ul className="mt-2 text-muted-foreground">
          {Object.entries(data.checks).map(([name, status]) => (
            <li key={name}>
              {name}: {status}
            </li>
          ))}
        </ul>
      )}
      {error instanceof ApiError && <p className="mt-2 text-muted-foreground">{error.message}</p>}
    </div>
  );
}
