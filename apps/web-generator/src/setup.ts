import { z } from "zod";

// Zod compiles its schemas with `new Function` when it can. This page runs under a Content-Security-Policy that forbids
// that (it also forbids every network request), and the attempt is a policy violation even though Zod copes with the
// refusal. Switching the compiler off keeps the page quiet. It must run before the config schema is built, so it is
// the first import of the entry.
z.config({ jitless: true });
