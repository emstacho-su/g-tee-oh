/**
 * A scripted model for the Ask tests (R3.20, O-305): it records every request (system prompt, user
 * turn, max tokens) and answers from a queue of scripted replies, so a test counts calls, reads
 * what the model was sent, and plants an unsupported number. No network, no key. A reply may be an
 * Error (the call fails) or wait on a gate (a test holds a call open to race another request).
 */
import type { ModelClient, ModelRequest, ModelResponse } from "../../src/explain/model.js";

export const MOCK_MODEL_ID = "claude-opus-5-5";
const DEFAULT_INPUT_TOKENS = 1200;
const DEFAULT_OUTPUT_TOKENS = 300;

export interface ScriptedReply {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  /** When set, the call resolves only after this promise does. */
  gate?: Promise<void>;
}

export interface MockModel extends ModelClient {
  readonly calls: readonly ModelRequest[];
  /** Adds replies to the end of the queue. */
  script(...replies: readonly (ScriptedReply | Error)[]): void;
}

export function mockModel(...initial: readonly (ScriptedReply | Error)[]): MockModel {
  const calls: ModelRequest[] = [];
  const queue: (ScriptedReply | Error)[] = [...initial];
  return {
    calls,
    script: (...replies) => {
      queue.push(...replies);
    },
    complete: async (request): Promise<ModelResponse> => {
      calls.push(request);
      const reply = queue.shift();
      if (reply === undefined) {
        throw new Error("the mock model has no scripted reply left");
      }
      if (reply instanceof Error) {
        throw reply;
      }
      await reply.gate;
      return {
        text: reply.text,
        inputTokens: reply.inputTokens ?? DEFAULT_INPUT_TOKENS,
        outputTokens: reply.outputTokens ?? DEFAULT_OUTPUT_TOKENS,
        model: MOCK_MODEL_ID,
      };
    },
  };
}
