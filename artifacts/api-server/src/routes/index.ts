import { Router, type IRouter } from "express";
import healthRouter from "./health";
import nowpaymentsIpnRouter from "./nowpayments-ipn";

const router: IRouter = Router();

router.use(healthRouter);
router.use(nowpaymentsIpnRouter);

export default router;
