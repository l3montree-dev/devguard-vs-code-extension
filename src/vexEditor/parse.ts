import {
  VEXVuln,
  CDX_STATE_TO_STATUS,
  Bom,
  Vulnerability,
  VulnerabilityRating,
  VulnerabilityAffect,
} from "./vex";

export function parseVexDocument(json: Bom): Map<string, VEXVuln[]> {
  const vexVulns: Map<string, VEXVuln[]> = new Map();

  json.vulnerabilities?.forEach((vuln: Vulnerability) => {
    let vulnRating: VulnerabilityRating | undefined = vuln.ratings?.find(
      (rating) => (rating.method as string) === "DevGuard",
    );
    if (!vulnRating) {
      vulnRating = vuln.ratings?.[0];
    }

    vuln.affects?.forEach((affectedPackage: VulnerabilityAffect) => {
      const entry: VEXVuln = {
        vulnID: vuln.id ?? "",
        packageName: affectedPackage.ref,
        status: CDX_STATE_TO_STATUS[vuln.analysis?.state ?? "undefined"],
        rating: vulnRating,
        justificationDetail: vuln.analysis?.detail ?? "",
      };

      const existing = vexVulns.get(affectedPackage.ref);
      if (!existing) {
        vexVulns.set(affectedPackage.ref, [entry]);
      } else {
        existing.push(entry);
      }
    });
  });

  return vexVulns;
}
