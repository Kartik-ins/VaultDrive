/**
 * @file app.error.ts
 */

/**
 * Interface representing a custom application error.
 */
export interface AppError extends Error {
    statusCode: number;
}

export enum HttpStatusCode {
    Ok = 200,
    BadRequest = 400,
    Unauthorized = 401,
    Forbidden = 403,
    NotFound = 404,
    Conflict = 409,
    InternalServerError = 500,
    NotImplemented = 501
}

export const getHttpStatusMessage = (statusCode: HttpStatusCode): string => {
    switch (statusCode) {
        case HttpStatusCode.Ok:
            return "OK";
        case HttpStatusCode.BadRequest:
            return "Bad Request";
        case HttpStatusCode.Unauthorized:
            return "Unauthorized";
        case HttpStatusCode.Forbidden:
            return "Forbidden";
        case HttpStatusCode.NotFound:
            return "Not Found";
        case HttpStatusCode.Conflict:
            return "Conflict";
        case HttpStatusCode.InternalServerError:
            return "Internal Server Error";
        case HttpStatusCode.NotImplemented:
            return "Not Implemented";
        default:
            return "Unknown Error";
    }
}


/**
 * Represents an internal server error.
 * Implements the `AppError` interface.
 *
 * @class InternalServerError
 * @implements {AppError}
 */
export class InternalServerError implements AppError {
    statusCode: number;
    message: string;
    name: string;
    constructor(message: string) {
        this.statusCode = HttpStatusCode.InternalServerError;
        this.message = message;
        this.name = "InternalServerError";
    }
}

/**
 * Represents a Bad Request error (HTTP 400).
 * This error is typically used to indicate that the server cannot process the request
 * due to client-side issues such as invalid input or malformed request syntax.
 *
 * @class BadRequestError
 * @implements {AppError}
 */
export class BadRequestError implements AppError {
    statusCode: number;
    message: string;
    name: string;
    constructor(message: string) {
        this.statusCode = HttpStatusCode.BadRequest;
        this.message = message;
        this.name = "BadRequestError";
    }
}

/**
 * Represents a "Not Found" error.
 * Implements the `AppError` interface.
 * This error is typically used to indicate that a requested resource could not be found.
 *
 * @class NotFoundError
 * @implements {AppError}
 */
export class NotFoundError implements AppError {
    statusCode: number;
    message: string;
    name: string;
    constructor(message: string) {
        this.statusCode = HttpStatusCode.NotFound;
        this.message = message;
        this.name = "NotFoundError";
    }
}

/**
 * Represents an Unauthorized error (HTTP 401).
 * This error is typically used to indicate that the request requires user authentication.
 * 
 * @class UnauthorizedError
 * @implements {AppError}
 */
export class UnauthorizedError implements AppError {
    statusCode: number;
    message: string;
    name: string;
    constructor(message: string) {
        this.statusCode = HttpStatusCode.Unauthorized;
        this.message = message;
        this.name = "UnauthorizedError";
    }
}


/**
 * Represents a Forbidden error (HTTP 403).
 * This error is typically used to indicate that the server understands the request
 * but refuses to authorize it.
 * 
 * @class ForbiddenError
 * @implements {AppError}
 */
export class ForbiddenError implements AppError {
    statusCode: number;
    message: string;
    name: string;
    constructor(message: string) {
        this.statusCode = HttpStatusCode.Forbidden;
        this.message = message;
        this.name = "ForbiddenError";
    }
}

/**
 * Represents a Conflict error (HTTP 409).
 * This error is typically used to indicate that the request could not be completed
 * due to a conflict with the current state of the target resource.
 * 
 * @class ConflictError
 * @implements {AppError}
 */
export class ConflictError implements AppError {
    statusCode: number;
    message: string;
    name: string;
    constructor(message: string) {
        this.statusCode = HttpStatusCode.Conflict;
        this.message = message;
        this.name = "ConflictError";
    }
}

/**
 * Represents an error for unimplemented functionality.
 * This error is used to indicate that a certain feature or method
 * has not been implemented yet.
 *
 * @class NotImplementedError
 * @implements {AppError}
 */
export class NotImplementedError implements AppError {
    statusCode: number;
    message: string;
    name: string;
    constructor(message: string) {
        this.statusCode = HttpStatusCode.NotImplemented;
        this.message = message;
        this.name = "NotImplementedError";
    }
}