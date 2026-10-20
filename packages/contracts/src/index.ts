/**
 * @g-tee-oh/contracts is the contract layer between the Rust services, the api service and the
 * web app. S06 lands the generated OpenAPI (Open Application Programming Interface) TypeScript
 * clients and the JSON (JavaScript Object Notation) schemas here (A1 section 3). It depends on no
 * other workspace package (A1 section 2). Until S06 this module only names the package (R0.1).
 */
export const PACKAGE_NAME = "@g-tee-oh/contracts" as const;
