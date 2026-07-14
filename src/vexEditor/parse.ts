import { VEXVuln, CDX_STATE_TO_STATUS } from "./vex";

export function parseVexDocument(json: any): Map<string, VEXVuln[]> {
  const vexVulns: Map<string, VEXVuln[]> = new Map();
  json.vulnerabilities?.forEach((vuln: any) => {
    let vulnRating = vuln.ratings.find(
      (rating: any) => rating.method === "DevGuard",
    );
    if (!vulnRating) {
      vulnRating = vuln.ratings[0];
    }
    vuln.affects.forEach((affectedPackage: any) => {
      const existing = vexVulns.get(affectedPackage.ref);
      if (!existing) {
        vexVulns.set(affectedPackage.ref, [
          {
            vulnID: vuln.id,
            packageName: affectedPackage.ref,
            status: CDX_STATE_TO_STATUS[vuln.analysis.state],
            rating: vulnRating,
            justificationDetail: vuln.analysis.detail ?? "",
          },
        ]);
      } else {
        existing.push({
          vulnID: vuln.id,
          packageName: affectedPackage.ref,
          status: CDX_STATE_TO_STATUS[vuln.analysis.state],
          rating: vulnRating,
          justificationDetail: vuln.analysis.detail ?? "",
        });
      }
    });
  });
  return vexVulns;
}
