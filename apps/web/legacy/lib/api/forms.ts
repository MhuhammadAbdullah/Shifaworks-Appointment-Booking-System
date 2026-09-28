"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateFormInput,
  FileDto,
  FormDto,
  FormSubmissionDto,
  FormSummaryDto,
  ListFormsQuery,
  PendingFormDto,
  SaveFormFieldsInput,
  SubmitFormInput,
  UpdateFormInput,
} from "@booking/shared";
import { authedRequest } from "@/lib/auth/api";

type Query = Record<string, string | number | boolean | undefined>;
const data = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

export const formKeys = {
  all: ["forms"] as const,
  list: (q: Partial<ListFormsQuery>) => ["forms", "list", q] as const,
  one: (id: string) => ["forms", "one", id] as const,
  published: (id: string) => ["forms", "published", id] as const,
  submissions: (id: string, q: object) => ["forms", "submissions", id, q] as const,
  submission: (id: string) => ["form-submissions", id] as const,
  pending: ["form-submissions", "pending"] as const,
};

export function useForms(q: Partial<ListFormsQuery>, enabled = true) {
  return useQuery({
    queryKey: formKeys.list(q),
    queryFn: ({ signal }) => authedRequest<FormSummaryDto[]>("/forms", { query: q as Query, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useFormDefinition(id: string) {
  return useQuery({ queryKey: formKeys.one(id), queryFn: ({ signal }) => data(authedRequest<FormDto>(`/forms/${id}`, { signal })) });
}

export function usePublishedForm(id: string | null) {
  return useQuery({
    queryKey: formKeys.published(id ?? ""),
    queryFn: ({ signal }) => data(authedRequest<FormDto>(`/forms/${id}/published`, { signal })),
    enabled: Boolean(id),
  });
}

function useFormMutation<T>(request: (input: T) => Promise<FormDto>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (f) => {
      qc.setQueryData(formKeys.one(f.id), f);
      void qc.invalidateQueries({ queryKey: formKeys.all });
    },
  });
}

export const useCreateForm = () => useFormMutation((body: CreateFormInput) => data(authedRequest<FormDto>("/forms", { method: "POST", body })));
export const useUpdateForm = (id: string) =>
  useFormMutation((body: UpdateFormInput) => data(authedRequest<FormDto>(`/forms/${id}`, { method: "PATCH", body })));
export const useSaveFields = (id: string) =>
  useFormMutation((body: SaveFormFieldsInput) => data(authedRequest<FormDto>(`/forms/${id}/fields`, { method: "PUT", body })));
export const usePublishForm = (id: string) => useFormMutation(() => data(authedRequest<FormDto>(`/forms/${id}/publish`, { method: "POST" })));
export const useArchiveForm = (id: string) =>
  useFormMutation((restore: boolean) => data(authedRequest<FormDto>(`/forms/${id}/archive`, { method: "POST", body: { restore } })));

export function useDeleteForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedRequest<void>(`/forms/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: formKeys.all }),
  });
}

export function useFormSubmissions(formId: string, q: { page: number; search?: string }) {
  return useQuery({
    queryKey: formKeys.submissions(formId, q),
    queryFn: ({ signal }) => authedRequest<FormSubmissionDto[]>(`/forms/${formId}/submissions`, { query: { pageSize: 25, ...q }, signal }),
    placeholderData: keepPreviousData,
  });
}

export function useSubmission(id: string | null) {
  return useQuery({
    queryKey: formKeys.submission(id ?? ""),
    queryFn: ({ signal }) => data(authedRequest<FormSubmissionDto>(`/form-submissions/${id}`, { signal })),
    enabled: Boolean(id),
  });
}

export function usePendingForms(enabled = true) {
  return useQuery({
    queryKey: formKeys.pending,
    queryFn: ({ signal }) => data(authedRequest<PendingFormDto[]>("/form-submissions/pending", { signal })),
    enabled,
  });
}

export function useSubmitForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SubmitFormInput) => data(authedRequest<FormSubmissionDto>("/form-submissions", { method: "POST", body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: formKeys.pending });
      void qc.invalidateQueries({ queryKey: ["appointments"] });
      void qc.invalidateQueries({ queryKey: ["event-bookings"] });
      void qc.invalidateQueries({ queryKey: formKeys.all });
    },
  });
}

export async function uploadPrivateFile(file: Blob, name: string): Promise<FileDto> {
  const formData = new FormData();
  formData.append("file", file, name);
  return data(authedRequest<FileDto>("/files/private", { method: "POST", formData }));
}

/** Opens a short-lived signed URL for a private file in a new tab. */
export async function openPrivateFile(fileId: string): Promise<string> {
  const { url } = await data(authedRequest<{ url: string; expiresInSeconds: number }>(`/files/${fileId}/url`));
  return url;
}
