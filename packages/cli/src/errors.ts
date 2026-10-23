/** A failure the user can act on: printed as a message, not a stack trace. `exitCode` 2 = usage or config problem. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = 2,
  ) {
    super(message);
    this.name = "CliError";
  }
}
