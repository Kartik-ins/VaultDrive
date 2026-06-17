import { NextFunction, Request, Response } from "express";
import logger from "../config/logger.config";
import { HttpStatusCode } from "../utils/errors/app.error";

export const pingHandler = async (req: Request, res: Response, next: NextFunction) => {
    logger.info("Ping request received");
    res.status(HttpStatusCode.Ok).json({ message: "Pong!" });
}

// 1. have some unique id generator

// 2. put the id in the current request 