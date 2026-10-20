/**
 * @g-tee-oh/api is the Fastify service that fronts solver-query and the database for the web
 * app. S06 lands the Fastify hello serving its OpenAPI (Open Application Programming Interface)
 * document and S21 the real routes. It depends on @g-tee-oh/contracts and @g-tee-oh/learning and
 * nothing imports it (A1 section 2). Importing both here proves the workspace links resolve
 * under typecheck and test. Until S06 this module only names the package (R0.1).
 */
import { PACKAGE_NAME as CONTRACTS_PACKAGE_NAME } from "@g-tee-oh/contracts";
import { PACKAGE_NAME as LEARNING_PACKAGE_NAME } from "@g-tee-oh/learning";

export const PACKAGE_NAME = "@g-tee-oh/api" as const;

export const INTERNAL_DEPENDENCIES = [CONTRACTS_PACKAGE_NAME, LEARNING_PACKAGE_NAME] as const;
