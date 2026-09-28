import { Router } from "express";
import {
  createCategorySimpleSchema,
  createExpenseSchema,
  createFinanceCategorySchema,
  createFinanceTxSchema,
  expenseActionSchema,
  financeSummaryQuerySchema,
  idParamSchema,
  listExpensesQuerySchema,
  listFinanceTxQuerySchema,
  updateExpenseSchema,
  voidFinanceTxSchema,
} from "@booking/shared";
import { requireAnyPermission, requireAuth, requirePermission } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./finance.controller.js";

export const financeRouter = Router();
financeRouter.use(requireAuth);

// --- ledger ------------------------------------------------------------------------
financeRouter.get("/summary", requirePermission("finance.view"), validate({ query: financeSummaryQuerySchema }), controller.financeSummary);
financeRouter.get("/transactions", requirePermission("finance.view"), validate({ query: listFinanceTxQuerySchema }), controller.listTransactions);
financeRouter.get("/transactions/export", requirePermission("finance.export"), validate({ query: listFinanceTxQuerySchema }), controller.exportTransactionsCsv);
financeRouter.post("/transactions", requirePermission("finance.create"), validate({ body: createFinanceTxSchema }), controller.createManualTransaction);
financeRouter.post(
  "/transactions/:id/void",
  requirePermission("finance.update"),
  validate({ params: idParamSchema, body: voidFinanceTxSchema }),
  controller.voidTransaction,
);

financeRouter.get("/categories", requireAnyPermission("finance.view", "expenses.view"), controller.listFinanceCategories);
financeRouter.post("/categories", requirePermission("finance.update"), validate({ body: createFinanceCategorySchema }), controller.createFinanceCategory);

// --- expenses ----------------------------------------------------------------------
financeRouter.get("/expense-categories", requireAnyPermission("expenses.view", "finance.view"), controller.listExpenseCategories);
financeRouter.post("/expense-categories", requirePermission("expenses.approve"), validate({ body: createCategorySimpleSchema }), controller.createExpenseCategory);

financeRouter.get("/expenses", requirePermission("expenses.view"), validate({ query: listExpensesQuerySchema }), controller.listExpenses);
financeRouter.get("/expenses/export", requirePermission("expenses.view"), validate({ query: listExpensesQuerySchema }), controller.exportExpensesCsv);
financeRouter.post("/expenses", requirePermission("expenses.create"), validate({ body: createExpenseSchema }), controller.createExpense);
financeRouter.get("/expenses/:id", requirePermission("expenses.view"), validate({ params: idParamSchema }), controller.getExpense);
financeRouter.patch("/expenses/:id", requirePermission("expenses.update"), validate({ params: idParamSchema, body: updateExpenseSchema }), controller.updateExpense);
financeRouter.post("/expenses/:id/actions", requirePermission("expenses.approve"), validate({ params: idParamSchema, body: expenseActionSchema }), controller.expenseAction);
financeRouter.delete("/expenses/:id", requirePermission("expenses.update"), validate({ params: idParamSchema }), controller.deleteExpense);
