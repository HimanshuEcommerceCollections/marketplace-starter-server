export { zipCodesRouter } from "./zip-codes.routes";
export { zipCodesService } from "./zip-codes.service";
// Re-exported for the coverage resolver, the booking flow and any future importer:
// there must be exactly ONE definition of what a ZIP is.
export { normalizeZip } from "./zip-codes.validation";
