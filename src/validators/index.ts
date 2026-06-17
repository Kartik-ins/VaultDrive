import { NextFunction, Request, Response } from "express";
import { AnyZodObject } from "zod";
import logger from "../config/logger.config";
import { HttpStatusCode } from "../utils/errors/app.error";

/**
 * 
 * @param schema - Zod schema to validate the request body
 * @returns - Middleware function to validate the request body
 */
export const validateRequestBody = (schema: AnyZodObject) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {

            logger.info("Validating request body");
            await schema.parseAsync(req.body);
            logger.info("Request body is valid");
            next();

        } catch (error) {
            // If the validation fails, 
            logger.error("Request body is invalid");
            res.status(HttpStatusCode.BadRequest).json({
                message: "Invalid request body",
                success: false,
                error: error
            });
            
        }
    }
}

/**
 * 
 * @param schema - Zod schema to validate the request body
 * @returns - Middleware function to validate the request query params
 */
export const validateQueryParams = (schema: AnyZodObject) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {

            await schema.parseAsync(req.query);
            console.log("Query params are valid");
            next();

        } catch (error) {
            // If the validation fails, 

            res.status(HttpStatusCode.BadRequest).json({
                message: "Invalid query params",
                success: false,
                error: error
            });
            
        }
    }
}

/**
 * Validate path parameters using a Zod schema.
 */
export const validateParams = (schema: AnyZodObject) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            logger.info("Validating path parameters");
            await schema.parseAsync(req.params);
            logger.info("Path parameters are valid");
            next();
        } catch (error) {
            logger.error("Path parameters are invalid");
            res.status(HttpStatusCode.BadRequest).json({
                message: "Invalid path parameters",
                success: false,
                error: error
            });
        }
    }
}


