import { Mastra } from "@mastra/core";
import { askAlex } from "./agents/ask-alex.js";

export const mastra = new Mastra({ agents: { askAlex } });
