import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/auth";
import { setNoStore } from "../http/no-store";
import { listWholesaleEmployees } from "./wholesale-employees-repository";

export async function listWholesaleEmployeesHandler(
  req: AuthenticatedRequest,
  res: Response,
): Promise<void> {
  void req;
  const employees = await listWholesaleEmployees();
  setNoStore(res);
  res.status(200).json({
    employees,
    total: employees.length,
  });
}
