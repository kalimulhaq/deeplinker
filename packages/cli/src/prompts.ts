import * as clack from "@clack/prompts";
import { CliError } from "./errors";

/** The few prompt types `init` needs. Tests supply their own; the terminal one wraps @clack/prompts. */
export interface Prompter {
  intro(message: string): void;
  outro(message: string): void;
  text(o: {
    message: string;
    placeholder?: string;
    initialValue?: string;
    validate?: (value: string) => string | undefined;
  }): Promise<string>;
  multiselect<T extends string>(o: {
    message: string;
    options: { value: T; label: string; hint?: string }[];
  }): Promise<T[]>;
}

/** Ctrl-C in a prompt: stop cleanly, write nothing. */
function answered<T>(value: T): Exclude<T, symbol> {
  if (clack.isCancel(value)) throw new CliError("Cancelled. Nothing was written.", 1);
  return value as Exclude<T, symbol>;
}

export const clackPrompter: Prompter = {
  intro: (message) => clack.intro(message),
  outro: (message) => clack.outro(message),
  async text(o) {
    const value = answered(
      await clack.text({
        message: o.message,
        placeholder: o.placeholder,
        initialValue: o.initialValue,
        validate: o.validate ? (v) => o.validate?.(v ?? "") : undefined,
      }),
    );
    return String(value ?? "");
  },
  async multiselect<T extends string>(o: {
    message: string;
    options: { value: T; label: string; hint?: string }[];
  }) {
    return answered(
      await clack.multiselect<T>({ message: o.message, options: o.options as never, required: false }),
    );
  },
};
