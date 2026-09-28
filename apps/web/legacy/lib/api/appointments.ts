"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AppointmentDto,
  AppointmentNoteDto,
  AvailabilityDto,
  BookAppointmentInput,
  CalendarEventDto,
  CalendarQuery,
  CancelAppointmentInput,
  CreateAppointmentInput,
  CreateBlockedSlotInput,
  CreateExceptionInput,
  CreateHolidayInput,
  CreateNoteInput,
  HolidayDto,
  ListAppointmentsQuery,
  ProviderSlotsDto,
  RescheduleAppointmentInput,
  SlotQuery,
  TransitionTarget,
  WeeklyScheduleInput,
} from "@booking/shared";
import { authedRequest } from "@/lib/auth/api";
import { apiRequest } from "@/lib/api-client";

type Query = Record<string, string | number | boolean | undefined>;
const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

export const apptKeys = {
  all: ["appointments"] as const,
  list: (q: Partial<ListAppointmentsQuery>) => ["appointments", "list", q] as const,
  one: (id: string) => ["appointments", "one", id] as const,
  notes: (id: string) => ["appointments", "notes", id] as const,
  calendar: (q: Partial<CalendarQuery>) => ["appointments", "calendar", q] as const,
  slots: ["slots"] as const,
  availability: (providerId: string) => ["availability", providerId] as const,
  holidays: ["availability", "holidays"] as const,
};

// ---- slots ------------------------------------------------------------------------

/** mode "staff" uses the authenticated endpoint (no notice limits); "online" the public one. */
export function useSlots(query: SlotQuery | null, mode: "staff" | "online") {
  return useQuery({
    queryKey: [...apptKeys.slots, mode, query],
    queryFn: ({ signal }) => {
      const q = query as unknown as Query;
      return mode === "staff"
        ? data(authedRequest<ProviderSlotsDto[]>("/availability/slots", { query: q, signal }))
        : data(apiRequest<ProviderSlotsDto[]>("/public/slots", { query: q, signal }));
    },
    enabled: Boolean(query),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

// ---- availability -----------------------------------------------------------------

export function useAvailability(providerId: string) {
  return useQuery({
    queryKey: apptKeys.availability(providerId),
    queryFn: ({ signal }) => data(authedRequest<AvailabilityDto>(`/availability/providers/${providerId}`, { signal })),
  });
}

function useAvailabilityMutation<T>(providerId: string, request: (input: T) => Promise<AvailabilityDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (dto) => {
      qc.setQueryData(apptKeys.availability(providerId), dto);
      void qc.invalidateQueries({ queryKey: apptKeys.slots });
      void qc.invalidateQueries({ queryKey: ["appointments", "calendar"] });
    },
  });
}

export const useSaveSchedule = (providerId: string) =>
  useAvailabilityMutation(providerId, (body: WeeklyScheduleInput) =>
    data(authedRequest<AvailabilityDto>(`/availability/providers/${providerId}/schedule`, { method: "PUT", body })),
  );
export const useAddException = (providerId: string) =>
  useAvailabilityMutation(providerId, (body: CreateExceptionInput) =>
    data(authedRequest<AvailabilityDto>(`/availability/providers/${providerId}/exceptions`, { method: "POST", body })),
  );
export const useRemoveException = (providerId: string) =>
  useAvailabilityMutation(providerId, (id: string) =>
    data(authedRequest<AvailabilityDto>(`/availability/providers/${providerId}/exceptions/${id}`, { method: "DELETE" })),
  );
export const useAddBlock = (providerId: string) =>
  useAvailabilityMutation(providerId, (body: CreateBlockedSlotInput) =>
    data(authedRequest<AvailabilityDto>(`/availability/providers/${providerId}/blocks`, { method: "POST", body })),
  );
export const useRemoveBlock = (providerId: string) =>
  useAvailabilityMutation(providerId, (id: string) =>
    data(authedRequest<AvailabilityDto>(`/availability/providers/${providerId}/blocks/${id}`, { method: "DELETE" })),
  );

export function useHolidays() {
  return useQuery({
    queryKey: apptKeys.holidays,
    queryFn: ({ signal }) => data(authedRequest<HolidayDto[]>("/availability/holidays", { signal })),
  });
}
export function useHolidayMutations() {
  const qc = useQueryClient();
  const onSuccess = (list: HolidayDto[]) => {
    qc.setQueryData(apptKeys.holidays, list);
    void qc.invalidateQueries({ queryKey: apptKeys.slots });
  };
  return {
    add: useMutation({
      mutationFn: (body: CreateHolidayInput) => data(authedRequest<HolidayDto[]>("/availability/holidays", { method: "POST", body })),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: string) => data(authedRequest<HolidayDto[]>(`/availability/holidays/${id}`, { method: "DELETE" })),
      onSuccess,
    }),
  };
}

// ---- appointments -------------------------------------------------------------------

export function useAppointments(query: Partial<ListAppointmentsQuery>, enabled = true) {
  return useQuery({
    queryKey: apptKeys.list(query),
    queryFn: ({ signal }) => authedRequest<AppointmentDto[]>("/appointments", { query: query as Query, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useAppointment(id: string) {
  return useQuery({
    queryKey: apptKeys.one(id),
    queryFn: ({ signal }) => data(authedRequest<AppointmentDto>(`/appointments/${id}`, { signal })),
  });
}

export function useCalendarEvents(query: Partial<CalendarQuery> | null) {
  return useQuery({
    queryKey: apptKeys.calendar(query ?? {}),
    queryFn: ({ signal }) =>
      data(authedRequest<CalendarEventDto[]>("/appointments/calendar", { query: query as Query, signal })),
    enabled: Boolean(query?.from && query?.to),
    placeholderData: keepPreviousData,
  });
}

/** Every appointment mutation refreshes lists, calendars, slots and the detail cache. */
function useAppointmentMutation<T>(request: (input: T) => Promise<AppointmentDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (appt) => {
      qc.setQueryData(apptKeys.one(appt.id), appt);
      void qc.invalidateQueries({ queryKey: apptKeys.all });
      void qc.invalidateQueries({ queryKey: apptKeys.slots });
    },
  });
}

export const useCreateAppointment = () =>
  useAppointmentMutation(({ body, idempotencyKey }: { body: CreateAppointmentInput; idempotencyKey: string }) =>
    data(authedRequest<AppointmentDto>("/appointments", { method: "POST", body, idempotencyKey })),
  );
export const useBookAppointment = () =>
  useAppointmentMutation(({ body, idempotencyKey }: { body: BookAppointmentInput; idempotencyKey: string }) =>
    data(authedRequest<AppointmentDto>("/appointments/book", { method: "POST", body, idempotencyKey })),
  );
export const useSetAppointmentStatus = (id: string) =>
  useAppointmentMutation((status: TransitionTarget) =>
    data(authedRequest<AppointmentDto>(`/appointments/${id}/status`, { method: "PATCH", body: { status } })),
  );
export const useCancelAppointment = (id: string) =>
  useAppointmentMutation((body: CancelAppointmentInput) =>
    data(authedRequest<AppointmentDto>(`/appointments/${id}/cancel`, { method: "POST", body })),
  );
export const useRescheduleAppointment = (id: string) =>
  useAppointmentMutation((body: RescheduleAppointmentInput) =>
    data(authedRequest<AppointmentDto>(`/appointments/${id}/reschedule`, { method: "POST", body })),
  );

export function useAppointmentNotes(id: string, enabled = true) {
  return useQuery({
    queryKey: apptKeys.notes(id),
    queryFn: ({ signal }) => data(authedRequest<AppointmentNoteDto[]>(`/appointments/${id}/notes`, { signal })),
    enabled,
  });
}
export function useAddNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateNoteInput) =>
      data(authedRequest<AppointmentNoteDto[]>(`/appointments/${id}/notes`, { method: "POST", body })),
    onSuccess: (notes) => qc.setQueryData(apptKeys.notes(id), notes),
  });
}

/** Stable per-attempt key so a double-click or network retry never books twice. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
