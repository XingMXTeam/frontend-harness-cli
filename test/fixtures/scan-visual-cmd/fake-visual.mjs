// Stands in for a capture+visual pipeline: writes a fresh comparison report.
import { writeFileSync } from "node:fs";
writeFileSync("visual-results.json", JSON.stringify({
  verdict: "pass",
  results: [{ name: "home", status: "match", ratio: 0.001, maxDiffRatio: 0.01 }],
}));
