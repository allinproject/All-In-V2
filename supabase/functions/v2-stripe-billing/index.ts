import { billingHandler, readConfig } from "./handler.ts";

Deno.serve((request) => {
  try {
    return billingHandler(readConfig())(request);
  } catch {
    return Response.json({ error: "sandbox_configuration_required" }, {
      status: 503,
    });
  }
});
