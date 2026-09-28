import { Router } from "express";
import { updateMeSchema } from "@booking/shared";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import * as controller from "./auth.controller.js";

/**
 * Sign-in, password reset and token refresh are handled by Supabase Auth
 * directly from the web app (staff and providers only; public sign-up is
 * disabled). The API only exposes the resolved identity.
 */
export const authRouter = Router();

authRouter.use(requireAuth);
authRouter.get("/me", controller.getMe);
authRouter.patch("/me", validate({ body: updateMeSchema }), controller.updateMe);
authRouter.post("/logout", controller.logout);
