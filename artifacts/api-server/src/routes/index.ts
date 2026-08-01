import { Router, type IRouter } from "express";
import healthRouter from "./health";
import cryptopayWebhookRouter from "./cryptopay-webhook";

const router: IRouter = Router();

router.use(healthRouter);
router.use(cryptopayWebhookRouter);

export default router;
