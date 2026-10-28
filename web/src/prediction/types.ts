/**
 * Named aliases for the prediction drill's request shapes (S27 lane A, R3.16, O-303). The prompt
 * and result schemas have aliases in src/contracts.ts; the answer body has no schema name in the
 * contract, so its type is read from the generated path here, never redeclared by hand (O-38).
 */
import type { ApiPaths } from "@g-tee-oh/contracts";

import type { PredictionPrompt } from "../contracts.js";

export type PredictionAnswerBody = ApiPaths["/api/v1/prediction/{session}/answer"]["post"]["requestBody"]["content"]["application/json"];
export type PredictionAnswer = PredictionAnswerBody["answer"];
export type PredictionKind = PredictionPrompt["answer_kind"];
export type PredictionLadder = PredictionPrompt["ladder"];
export type HandRegion = NonNullable<PredictionPrompt["regions"]>[number];
export type FrequencyBand = NonNullable<PredictionPrompt["bands"]>[number];
