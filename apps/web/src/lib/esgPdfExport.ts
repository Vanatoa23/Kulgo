import type { AnalyticsSummary, Organization } from "@kulgo/shared";

/**
 * Escapes parentheses and backslashes for PDF literal string objects `( ... )`
 * and strips non-ASCII characters to safe Latin-1 / ASCII printable range.
 */
function pdfSafeText(input: string): string {
  return input
    .replace(/€/g, "EUR ")
    .replace(/→/g, "->")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/×/g, "x")
    .replace(/—/g, "-")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapLine(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (!current) {
      current = w;
    } else if (current.length + 1 + w.length <= maxChars) {
      current += ` ${w}`;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/**
 * Generates a real, standards-compliant multi-page PDF 1.4 binary (zero external deps)
 * for Kulgo's Board / Bank-Ready ESG & Multi-Region Compliance Executive Summary.
 */
export function buildEsgExecutiveSummaryPdfBytes(
  organization: Organization,
  analytics: AnalyticsSummary,
  generatedAtIso: string = new Date().toISOString(),
): Uint8Array {
  const esg = analytics.esg;
  const lines: Array<{ text: string; size: number; bold?: boolean; gap?: number }> = [];

  const pushHeading = (text: string) => {
    lines.push({ text, size: 13, bold: true, gap: 18 });
  };
  const pushBody = (text: string, size = 9.5) => {
    for (const wrapped of wrapLine(text, 88)) {
      lines.push({ text: wrapped, size, gap: 13 });
    }
  };

  // Header
  lines.push({
    text: "KULGO - ESG & MULTI-REGION COMPLIANCE EXECUTIVE SUMMARY",
    size: 15,
    bold: true,
    gap: 20,
  });
  pushBody(
    `Organization: ${organization.name} (${organization.countryCode}) | Sector: ${organization.sector}`,
  );
  pushBody(
    `Generated: ${generatedAtIso.slice(0, 10)} | Factor Matrix: v${esg.factorMatrixVersion ?? "2026.1"} | Active Packs: ${(esg.activeCompliancePacks ?? ["GLOBAL_GHG_ISSB"]).join(", ")}`,
  );
  lines.push({ text: "----------------------------------------------------------------------------------------", size: 9, gap: 14 });

  // Section 1: Scope 1/2/3 & PCAF
  pushHeading("1. GHG Protocol Scope 1 / 2 / 3 Inventory & Data Quality");
  pushBody(
    `Total Footprint (Location-Based): ${esg.totalTco2e.toLocaleString("en-US", { maximumFractionDigits: 2 })} tCO2e | Weighted PCAF-Aligned Score: ${esg.weightedPcafScore !== null && esg.weightedPcafScore !== undefined ? `${esg.weightedPcafScore} / 5.0` : "N/A"} (1 = highest)`,
  );
  pushBody(
    `Scope 1 (Direct): ${esg.scope1Tco2e} tCO2e | Scope 2 (Location): ${esg.scope2LocationTco2e ?? esg.scope2Tco2e} tCO2e | Scope 2 (Market): ${esg.scope2MarketTco2e !== null && esg.scope2MarketTco2e !== undefined ? `${esg.scope2MarketTco2e} tCO2e` : "Not yet reported"}`,
  );
  pushBody(
    `Scope 3 Cat 1 (Purchased Goods): ${esg.upstreamScope3Tco2e} tCO2e | Scope 3 Cat 4 (Freight): ${esg.transportScope3Tco2e} tCO2e | Primary Supplier Data Share: ${esg.primaryDataSharePct ?? 0}%`,
  );
  if (esg.carbonIntensityPerEurMillion !== null && esg.carbonIntensityPerEurMillion !== undefined) {
    pushBody(
      `Carbon Intensity: ${esg.carbonIntensityPerEurMillion} tCO2e / EUR 1M revenue${esg.carbonIntensityPerTonne ? ` | ${esg.carbonIntensityPerTonne} tCO2e / tonne` : ""}`,
    );
  }
  lines.push({ text: "", size: 8, gap: 8 });

  // Section 2: Top Emission Hotspots
  pushHeading("2. Top Scope 3 Emission Hotspots (Tier-1 Anonymized)");
  const hotspots = esg.hotspots ?? [];
  if (hotspots.length === 0) {
    pushBody("No active Scope 3 Category 1 lanes recorded yet.");
  } else {
    hotspots.forEach((h, idx) => {
      pushBody(
        `${idx + 1}. ${h.entityName} (${h.countryCode}) - ${h.materialCategory}: ${h.tco2e} tCO2e (${h.shareOfScope3Pct}% of Scope 3) | Method: ${h.attributionMethod} | Score: ${h.pcafScore}${h.cbamCategory ? ` | CBAM: ${h.cbamCategory}` : ""}`,
      );
    });
  }
  lines.push({ text: "", size: 8, gap: 8 });

  // Section 3: EU CBAM Summary
  if (esg.cbamSummary) {
    pushHeading("3. EU CBAM Embedded Emissions Screening");
    pushBody(
      `Applicable: ${esg.cbamSummary.euCbamApplicable ? "YES" : "NO"} | Non-EU CBAM Mass: ${esg.cbamSummary.cumulativeMassTonnes} t (De Minimis Threshold: ${esg.cbamSummary.deMinimisThresholdTonnes} t/yr) | Flagged Lanes: ${esg.cbamSummary.flaggedLanesCount} (${esg.cbamSummary.defaultFactorLanesCount} using default values)`,
    );
    lines.push({ text: "", size: 8, gap: 8 });
  }

  // Section 4: Multi-Region Compliance Checklist
  pushHeading("4. Multi-Region Compliance Readiness Checklist");
  const checklist = esg.complianceChecklist ?? [];
  for (const item of checklist) {
    pushBody(
      `[${item.status}] (${item.packId} / ${item.legalStatus}) ${item.title} - ${item.summary}`,
    );
  }
  lines.push({ text: "", size: 8, gap: 8 });

  // Privacy & Provenance Attestation
  pushHeading("5. Audit Trail & Privacy Attestation");
  pushBody(
    "All Scope 3 Category 1 partner attributions follow GHG Protocol proportional attribution (zero 100%-entity over-attribution). Verified partner revenues and Tier-2+ identities remain strictly confidential server-side per Kulgo Privacy Contract. Open-source factors: ADEME Base Carbone (Etalab 2.0), UK DESNZ 2026 (OGL v3.0), EU JRC CBAM (CC-BY 4.0), EXIOBASE v3.8.2 pxp (CC-BY-SA 4.0), US EPA USEEIO v1.3 (CC0 1.0), EEA/Ember 2026 (CC-BY 4.0).",
  );

  // Paginate lines onto A4 pages (595 x 842 pt)
  const pages: string[][] = [];
  let currentOps: string[] = [];
  let y = 800;

  for (const item of lines) {
    const gap = item.gap ?? 13;
    if (y - gap < 48) {
      pages.push(currentOps);
      currentOps = [];
      y = 800;
    }
    if (item.text.length > 0) {
      const font = item.bold ? "/F2" : "/F1";
      currentOps.push(
        `BT ${font} ${item.size} Tf 42 ${y} Td (${pdfSafeText(item.text)}) Tj ET`,
      );
    }
    y -= gap;
  }
  if (currentOps.length > 0 || pages.length === 0) {
    pages.push(currentOps);
  }

  // Assemble PDF 1.4 objects
  const objects: string[] = [];
  const addObj = (body: string): number => {
    objects.push(body);
    return objects.length;
  };

  const fontRegularId = addObj(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  );
  const fontBoldId = addObj(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  );

  const pageIds: number[] = [];
  const pagesPlaceholderId = addObj(""); // will be replaced once pageIds are known

  for (const ops of pages) {
    const stream = ops.join("\n");
    const contentId = addObj(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
    const pageId = addObj(
      `<< /Type /Page /Parent ${pagesPlaceholderId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  objects[pagesPlaceholderId - 1] = `<< /Type /Pages /Kids [${pageIds
    .map((id) => `${id} 0 R`)
    .join(" ")}] /Count ${pageIds.length} >>`;

  const catalogId = addObj(
    `<< /Type /Catalog /Pages ${pagesPlaceholderId} 0 R >>`,
  );

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(pdf);
}

export function downloadEsgExecutiveSummaryPdf(
  organization: Organization,
  analytics: AnalyticsSummary,
): void {
  const bytes = buildEsgExecutiveSummaryPdfBytes(organization, analytics);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `kulgo-esg-executive-summary-${organization.slug}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
