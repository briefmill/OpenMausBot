import { expect, it } from "vitest";
import { hostedOutputBudget } from "./hosted-output-budget.ts";
it("retains the existing role cap only on OpenRouter", () => {
  expect(hostedOutputBudget("004e47f0-e544-4760-84fa-f3212b45b8ac", "https://openrouter.ai/api/v1")).toBe(8192);
  expect(hostedOutputBudget("004e47f0-e544-4760-84fa-f3212b45b8ac", "https://api.openai.com/v1")).toBeUndefined();
  expect(hostedOutputBudget("unassigned-bot", "https://openrouter.ai/api/v1")).toBeUndefined();
  expect(hostedOutputBudget(undefined, "invalid")).toBeUndefined();
});
