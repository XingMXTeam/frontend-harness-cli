// Rule modules, one per dimension. This barrel keeps the historical
// import surface (`../rules.js`) stable for evaluate.js and the tests.
export { checkStructure } from "./rules/structure.js";
export { checkData } from "./rules/data.js";
export { checkLogic } from "./rules/logic.js";
export { checkUi } from "./rules/ui.js";
export { checkE2e } from "./rules/e2e.js";
export { applyExemptions, buildContext } from "./rules/shared.js";
