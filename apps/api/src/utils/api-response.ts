import type { Response } from "express";
import type { ApiSuccess, PaginationMeta } from "@booking/shared";

export function sendOk<T>(res: Response, data: T, message?: string): Response<ApiSuccess<T>> {
  const body: ApiSuccess<T> = { success: true, data, ...(message ? { message } : {}) };
  return res.status(200).json(body);
}

export function sendCreated<T>(res: Response, data: T, message?: string): Response<ApiSuccess<T>> {
  const body: ApiSuccess<T> = { success: true, data, ...(message ? { message } : {}) };
  return res.status(201).json(body);
}

export function sendPaginated<T>(
  res: Response,
  items: T[],
  meta: Omit<PaginationMeta, "totalPages">,
): Response<ApiSuccess<T[]>> {
  const body: ApiSuccess<T[]> = {
    success: true,
    data: items,
    meta: { ...meta, totalPages: Math.max(1, Math.ceil(meta.total / meta.pageSize)) },
  };
  return res.status(200).json(body);
}

export function sendNoContent(res: Response): Response {
  return res.status(204).end();
}
