/**
 * @g-tee-oh/web is the React and TypeScript single-page app built with Vite. S06 lands the Vite
 * skeleton with the router and the Playwright smoke flow and S24 the trainer screens. It depends
 * on @g-tee-oh/contracts for the generated api client and on nothing else in the workspace
 * (A1 section 2). Importing it here proves the workspace link resolves under typecheck and
 * test. Until S06 this module only names the package (R0.1).
 */
import { PACKAGE_NAME as CONTRACTS_PACKAGE_NAME } from "@g-tee-oh/contracts";

export const PACKAGE_NAME = "@g-tee-oh/web" as const;

export const INTERNAL_DEPENDENCIES = [CONTRACTS_PACKAGE_NAME] as const;
