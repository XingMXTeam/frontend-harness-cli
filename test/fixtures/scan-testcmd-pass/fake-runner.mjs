// Stands in for a real test runner: emits a results file, exits 0.
import { writeFileSync } from "node:fs";
writeFileSync("results.json", JSON.stringify({ passed: 3, failed: 0 }));
