/** Domain error with an assigned HTTP status. The API layer maps it to a response. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const notFound = (what: string) => new AppError(404, `${what} not found`);
export const badRequest = (msg: string) => new AppError(400, msg);
export const unprocessable = (msg: string) => new AppError(422, msg);
