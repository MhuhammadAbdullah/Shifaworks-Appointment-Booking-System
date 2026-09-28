import type { RequestHandler } from "express";
import type {
  CreateExpenseInput,
  CreateFinanceCategoryInput,
  CreateFinanceTxInput,
  ExpenseActionInput,
  FinanceSummaryQuery,
  ListExpensesQuery,
  ListFinanceTxQuery,
  UpdateExpenseInput,
  VoidFinanceTxInput,
} from "@booking/shared";
import { principalOf } from "../../middleware/auth.js";
import { validated } from "../../middleware/validate.js";
import { sendCreated, sendNoContent, sendOk, sendPaginated } from "../../utils/api-response.js";
import { auditContextFrom } from "../audit/audit.service.js";
import * as expenses from "./expenses.service.js";
import * as finance from "./finance.service.js";

type IdParams = { id: string };
type NameBody = { name: string };

// --- ledger ------------------------------------------------------------------------

export const financeSummary: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, FinanceSummaryQuery>(req);
  sendOk(res, await finance.financeSummary(principalOf(req), query.from, query.to));
};

export const listTransactions: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, ListFinanceTxQuery>(req);
  const { items, ...meta } = await finance.listTransactions(principalOf(req), query);
  sendPaginated(res, items, meta);
};

export const exportTransactionsCsv: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, ListFinanceTxQuery>(req);
  const csv = await finance.exportTransactionsCsv(principalOf(req), query);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="transactions-${query.from ?? "all"}-${query.to ?? "all"}.csv"`);
  res.send(csv);
};

export const createManualTransaction: RequestHandler = async (req, res) => {
  const { body } = validated<CreateFinanceTxInput>(req);
  sendCreated(res, await finance.createManualTransaction(principalOf(req), body, auditContextFrom(req)), "Entry recorded");
};

export const voidTransaction: RequestHandler = async (req, res) => {
  const { params, body } = validated<VoidFinanceTxInput, unknown, IdParams>(req);
  sendOk(res, await finance.voidTransaction(principalOf(req), params.id, body.reason, auditContextFrom(req)), "Entry voided");
};

export const listFinanceCategories: RequestHandler = async (req, res) => {
  sendOk(res, await finance.listFinanceCategories(principalOf(req)));
};

export const createFinanceCategory: RequestHandler = async (req, res) => {
  const { body } = validated<CreateFinanceCategoryInput>(req);
  sendCreated(res, await finance.createFinanceCategory(principalOf(req), body, auditContextFrom(req)));
};

// --- expenses ----------------------------------------------------------------------

export const listExpenseCategories: RequestHandler = async (req, res) => {
  sendOk(res, await expenses.listExpenseCategories(principalOf(req)));
};

export const createExpenseCategory: RequestHandler = async (req, res) => {
  const { body } = validated<NameBody>(req);
  sendCreated(res, await expenses.createExpenseCategory(principalOf(req), body.name, auditContextFrom(req)));
};

export const listExpenses: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, ListExpensesQuery>(req);
  const { items, sum, ...meta } = await expenses.listExpenses(principalOf(req), query);
  res.json({ success: true, data: items, meta: { ...meta, totalPages: Math.max(1, Math.ceil(meta.total / meta.pageSize)) }, sum });
};

export const createExpense: RequestHandler = async (req, res) => {
  const { body } = validated<CreateExpenseInput>(req);
  sendCreated(res, await expenses.createExpense(principalOf(req), body, auditContextFrom(req)), "Expense recorded");
};

export const getExpense: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  sendOk(res, await expenses.getExpense(principalOf(req), params.id));
};

export const updateExpense: RequestHandler = async (req, res) => {
  const { params, body } = validated<UpdateExpenseInput, unknown, IdParams>(req);
  sendOk(res, await expenses.updateExpense(principalOf(req), params.id, body, auditContextFrom(req)), "Expense updated");
};

export const expenseAction: RequestHandler = async (req, res) => {
  const { params, body } = validated<ExpenseActionInput, unknown, IdParams>(req);
  sendOk(res, await expenses.expenseAction(principalOf(req), params.id, body, auditContextFrom(req)));
};

export const deleteExpense: RequestHandler = async (req, res) => {
  const { params } = validated<unknown, unknown, IdParams>(req);
  await expenses.deleteExpense(principalOf(req), params.id, auditContextFrom(req));
  sendNoContent(res);
};

export const exportExpensesCsv: RequestHandler = async (req, res) => {
  const { query } = validated<unknown, ListExpensesQuery>(req);
  const csv = await expenses.exportExpensesCsv(principalOf(req), query);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="expenses-${query.from ?? "all"}-${query.to ?? "all"}.csv"`);
  res.send(csv);
};
