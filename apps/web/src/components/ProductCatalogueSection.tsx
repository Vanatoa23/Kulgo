import {
  CatalogueCapacityBandSchema,
  KULGO_MATERIAL_TAXONOMY,
  VolumeUnitSchema,
  type BulkCatalogueImportResult,
  type CatalogueCapacityBand,
  type CatalogueItem,
  type Organization,
  type StandardizedCategoryCode,
  type VolumeUnit,
} from "@kulgo/shared";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  Package,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  createCatalogueItem,
  deleteCatalogueItem,
  downloadAuthenticatedTemplate,
  importCatalogueSpreadsheet,
  listCatalogueItems,
} from "../lib/api.js";

export interface ProductCatalogueSectionProps {
  organization: Organization;
  isOwner?: boolean;
  onEnableDirectoryOptIn?: () => Promise<void>;
}

function parseCommaList(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function ProductCatalogueSection({
  organization,
  isOwner = false,
  onEnableDirectoryOptIn,
}: ProductCatalogueSectionProps) {
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Add Product form state
  const [standardizedCategory, setStandardizedCategory] =
    useState<StandardizedCategoryCode>(
      KULGO_MATERIAL_TAXONOMY[0]?.code ?? "ALUMINUM_EXTRUSIONS",
    );
  const [productTitle, setProductTitle] = useState("");
  const [baseUnit, setBaseUnit] = useState<VolumeUnit>("TONNES");
  const [pcfText, setPcfText] = useState("");
  const [pcfVerified, setPcfVerified] = useState(false);
  const [leadTimeText, setLeadTimeText] = useState("");
  const [moqText, setMoqText] = useState("");
  const [capacityBand, setCapacityBand] = useState<CatalogueCapacityBand | "">(
    "",
  );
  const [specsText, setSpecsText] = useState("");
  const [certificationsText, setCertificationsText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Bulk upload / template state
  const [importingFile, setImportingFile] = useState(false);
  const [importResult, setImportResult] =
    useState<BulkCatalogueImportResult | null>(null);
  const [downloadingTemplate, setDownloadingTemplate] = useState<
    "xlsx" | "csv" | null
  >(null);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const taxonomyByCode = useMemo(
    () => new Map(KULGO_MATERIAL_TAXONOMY.map((cat) => [cat.code, cat])),
    [],
  );

  const loadCatalogue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listCatalogueItems();
      setItems(list);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load public product catalogue.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalogue();
  }, [loadCatalogue]);

  const handleAddProduct = async (e: FormEvent) => {
    e.preventDefault();
    const trimmedTitle = productTitle.trim();
    if (!trimmedTitle) {
      setError("Product Title is required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setStatusMessage(null);

    try {
      const parseOptionalNonNegative = (
        raw: string,
        label: string,
        integer = false,
      ): number | null => {
        const trimmed = raw.trim();
        if (!trimmed) return null;
        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error(`${label} must be a non-negative number.`);
        }
        if (integer && !Number.isInteger(parsed)) {
          throw new Error(`${label} must be a whole number.`);
        }
        return parsed;
      };

      const pcf = parseOptionalNonNegative(pcfText, "PCF (tCO2e / unit)");
      const leadTimeDays = parseOptionalNonNegative(
        leadTimeText,
        "Lead Time (days)",
        true,
      );
      const moq = parseOptionalNonNegative(moqText, "MOQ");

      const created = await createCatalogueItem({
        standardizedCategory,
        productTitle: trimmedTitle,
        baseUnit,
        productEmissionFactorTco2ePerUnit: pcf,
        pcfVerified,
        leadTimeDays,
        moq,
        capacityBand: capacityBand || null,
        specs: parseCommaList(specsText),
        certifications: parseCommaList(certificationsText),
      });

      setItems((prev) => [created, ...prev]);
      setProductTitle("");
      setPcfText("");
      setPcfVerified(false);
      setLeadTimeText("");
      setMoqText("");
      setCapacityBand("");
      setSpecsText("");
      setCertificationsText("");
      setStatusMessage(`Added "${created.productTitle}" to your catalogue.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to add catalogue item.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteItem = async (item: CatalogueItem) => {
    setDeletingItemId(item.itemId);
    setError(null);
    setStatusMessage(null);
    try {
      await deleteCatalogueItem(item.itemId);
      setItems((prev) => prev.filter((i) => i.itemId !== item.itemId));
      setStatusMessage(`Removed "${item.productTitle}" from your catalogue.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete catalogue item.",
      );
    } finally {
      setDeletingItemId(null);
    }
  };

  const handleDownloadTemplate = async (format: "xlsx" | "csv") => {
    setDownloadingTemplate(format);
    setError(null);
    try {
      if (format === "xlsx") {
        await downloadAuthenticatedTemplate(
          "/api/v1/directory/catalogue/template.xlsx",
          "kulgo-catalogue-template.xlsx",
        );
      } else {
        await downloadAuthenticatedTemplate(
          "/api/v1/directory/catalogue/template.csv",
          "kulgo-catalogue-template.csv",
        );
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Failed to download .${format} catalogue template.`,
      );
    } finally {
      setDownloadingTemplate(null);
    }
  };

  const handleBulkUploadChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportingFile(true);
    setError(null);
    setStatusMessage(null);
    setImportResult(null);

    const isXlsx = file.name.toLowerCase().endsWith(".xlsx");
    const reader = new FileReader();

    reader.onload = async () => {
      try {
        const payload = isXlsx
          ? { xlsxBase64: arrayBufferToBase64(reader.result as ArrayBuffer) }
          : { csv: typeof reader.result === "string" ? reader.result : "" };
        const result = await importCatalogueSpreadsheet(payload);
        setImportResult(result);
        if (result.items.length > 0) {
          setItems((prev) => [...result.items, ...prev]);
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to import catalogue spreadsheet.",
        );
      } finally {
        setImportingFile(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    };

    reader.onerror = () => {
      setError("Failed to read the selected file.");
      setImportingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    };

    if (isXlsx) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  };

  return (
    <section
      data-testid="catalogue-section"
      className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 space-y-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Package className="h-4 w-4 text-emerald-400" />
            My Public Product Catalogue
          </h2>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Publish standardized materials and product specs so buyers can match
            your capabilities when sourcing alternatives.
          </p>
        </div>
        <span className="text-[11px] font-mono text-slate-400 bg-slate-950 border border-slate-800 px-2.5 py-1 rounded-lg">
          {items.length} item{items.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Discovery status banner when openToNewBuyers is false */}
      {!organization.openToNewBuyers && (
        <div
          role="status"
          className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-200"
        >
          <div className="flex items-start gap-2.5">
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-300" />
            <span>
              Your organization is currently hidden from buyer discovery. Enable{" "}
              <strong>&ldquo;Open to New Buyers&rdquo;</strong> in the Alternative
              Supplier Directory section above to make these catalogue items
              discoverable in buyers&apos;{" "}
              <strong>&ldquo;See alternatives (x)&rdquo;</strong> views. You can
              still prepare and manage your items below.
            </span>
          </div>
          {isOwner && onEnableDirectoryOptIn && (
            <button
              type="button"
              onClick={() => void onEnableDirectoryOptIn()}
              className="shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/20 hover:bg-amber-500/30 px-3 py-1.5 text-xs font-semibold text-amber-100 cursor-pointer"
            >
              Enable Directory Opt-In
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {statusMessage && (
        <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Bulk Upload & Templates Bar */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <FileSpreadsheet className="h-3.5 w-3.5 text-sky-400" />
            <span>Bulk Upload Catalogue</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDownloadTemplate("xlsx")}
              disabled={downloadingTemplate !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 px-2.5 py-1 text-[11px] font-medium text-slate-200 cursor-pointer"
            >
              {downloadingTemplate === "xlsx" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3 text-emerald-400" />
              )}
              <span>Download .xlsx Template</span>
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadTemplate("csv")}
              disabled={downloadingTemplate !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 px-2.5 py-1 text-[11px] font-medium text-slate-200 cursor-pointer"
            >
              {downloadingTemplate === "csv" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3 text-sky-400" />
              )}
              <span>Download .csv Template</span>
            </button>
            <label className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 cursor-pointer">
              {importingFile ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Upload className="h-3 w-3" />
              )}
              <span>
                {importingFile ? "Uploading..." : "Upload .csv / .xlsx"}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx"
                aria-label="Bulk upload catalogue spreadsheet"
                disabled={importingFile}
                onChange={handleBulkUploadChange}
                className="hidden"
              />
            </label>
          </div>
        </div>

        {importResult && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-2 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span>
                Imported {importResult.createdCount} catalogue item
                {importResult.createdCount === 1 ? "" : "s"}.
              </span>
            </div>
            {importResult.errors.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-950/40 p-2.5 space-y-1">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>
                    {importResult.errors.length} row issue
                    {importResult.errors.length === 1 ? "" : "s"} skipped:
                  </span>
                </div>
                <ul className="space-y-0.5 text-[11px] text-amber-200/90 font-mono max-h-28 overflow-y-auto">
                  {importResult.errors.map((err, idx) => (
                    <li key={`${err.row}-${idx}`}>
                      Row {err.row}
                      {err.field ? ` (${err.field})` : ""}: {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Product Form */}
      <form
        onSubmit={(e) => void handleAddProduct(e)}
        className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 space-y-3 text-xs"
      >
        <div className="font-semibold text-slate-200 flex items-center gap-1.5">
          <Plus className="h-3.5 w-3.5 text-emerald-400" />
          <span>Add Product</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label
              htmlFor="catalogue-category"
              className="block text-slate-300 font-medium"
            >
              Standardized Category
            </label>
            <select
              id="catalogue-category"
              value={standardizedCategory}
              onChange={(e) =>
                setStandardizedCategory(
                  e.target.value as StandardizedCategoryCode,
                )
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white"
            >
              {KULGO_MATERIAL_TAXONOMY.map((cat) => (
                <option key={cat.code} value={cat.code}>
                  {cat.label} (HS {cat.hsCode})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="catalogue-title"
              className="block text-slate-300 font-medium"
            >
              Product Title *
            </label>
            <input
              id="catalogue-title"
              type="text"
              required
              value={productTitle}
              onChange={(e) => setProductTitle(e.target.value)}
              placeholder="e.g., 6061-T6 Extruded Aluminum Enclosure"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="catalogue-unit"
              className="block text-slate-300 font-medium"
            >
              Base Unit
            </label>
            <select
              id="catalogue-unit"
              value={baseUnit}
              onChange={(e) => setBaseUnit(e.target.value as VolumeUnit)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white"
            >
              {VolumeUnitSchema.options.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="catalogue-pcf"
              className="block text-slate-300 font-medium"
            >
              PCF (tCO2e / unit)
            </label>
            <input
              id="catalogue-pcf"
              type="number"
              step="any"
              min={0}
              value={pcfText}
              onChange={(e) => {
                const val = e.target.value;
                setPcfText(val);
                if (!val.trim()) {
                  setPcfVerified(false);
                }
              }}
              placeholder="Optional (e.g., 4.2)"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="catalogue-lead-time"
              className="block text-slate-300 font-medium"
            >
              Lead Time (days)
            </label>
            <input
              id="catalogue-lead-time"
              type="number"
              min={0}
              max={365}
              step={1}
              value={leadTimeText}
              onChange={(e) => setLeadTimeText(e.target.value)}
              placeholder="Optional (e.g., 21)"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="catalogue-moq"
              className="block text-slate-300 font-medium"
            >
              MOQ
            </label>
            <input
              id="catalogue-moq"
              type="number"
              step="any"
              min={0}
              value={moqText}
              onChange={(e) => setMoqText(e.target.value)}
              placeholder="Optional (e.g., 50)"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="catalogue-capacity"
              className="block text-slate-300 font-medium"
            >
              Capacity Band
            </label>
            <select
              id="catalogue-capacity"
              value={capacityBand}
              onChange={(e) =>
                setCapacityBand(e.target.value as CatalogueCapacityBand | "")
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white"
            >
              <option value="">Not specified</option>
              {CatalogueCapacityBandSchema.options.map((band) => (
                <option key={band} value={band}>
                  {band}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="catalogue-specs"
              className="block text-slate-300 font-medium"
            >
              Specs / Tags (comma-separated)
            </label>
            <input
              id="catalogue-specs"
              type="text"
              value={specsText}
              onChange={(e) => setSpecsText(e.target.value)}
              placeholder="e.g., 6061-T6, Anodized, CNC"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="catalogue-certifications"
              className="block text-slate-300 font-medium"
            >
              Certifications (comma-separated)
            </label>
            <input
              id="catalogue-certifications"
              type="text"
              value={certificationsText}
              onChange={(e) => setCertificationsText(e.target.value)}
              placeholder="e.g., ISO 9001, ISO 14001"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-white"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <label
            htmlFor="catalogue-pcf-verified"
            className="inline-flex items-center gap-2 text-slate-300 cursor-pointer"
          >
            <input
              id="catalogue-pcf-verified"
              type="checkbox"
              checked={pcfVerified}
              onChange={(e) => setPcfVerified(e.target.checked)}
              className="rounded border-slate-700 bg-slate-950 accent-emerald-500"
            />
            <span>PCF Verified (third-party / ISO 14067)</span>
          </label>

          <button
            type="submit"
            data-testid="catalogue-add-submit"
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 px-3.5 py-1.5 text-xs font-semibold text-slate-950 cursor-pointer"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            <span>{submitting ? "Adding..." : "Add to Catalogue"}</span>
          </button>
        </div>
      </form>

      {/* Existing Catalogue Items List */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-slate-400 py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading product catalogue...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-6 text-center text-xs text-slate-500">
          No products in your catalogue yet. Add a product above or bulk upload
          a `.csv` / `.xlsx` template.
        </div>
      ) : (
        <ul
          aria-label="Public product catalogue items"
          className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/70"
        >
          {items.map((item) => {
            const catDef = taxonomyByCode.get(item.standardizedCategory);
            return (
              <li
                key={item.itemId}
                data-testid="catalogue-item-row"
                className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-white">
                      {item.productTitle}
                    </span>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-sky-500/35 bg-sky-500/15 text-sky-300">
                      {catDef
                        ? `${catDef.label} · HS ${catDef.hsCode}`
                        : item.standardizedCategory}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                      {item.baseUnit}
                    </span>
                    {item.capacityBand && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/35">
                        {item.capacityBand}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                    {item.productEmissionFactorTco2ePerUnit !== null && (
                      <span>
                        PCF:{" "}
                        <strong className="text-slate-200 font-mono">
                          {item.productEmissionFactorTco2ePerUnit} tCO2e/
                          {item.baseUnit.toLowerCase()}
                        </strong>
                        {item.pcfVerified && (
                          <span className="ml-1 text-[10px] text-emerald-300">
                            (Verified)
                          </span>
                        )}
                      </span>
                    )}
                    {item.leadTimeDays !== null && (
                      <span>
                        Lead time:{" "}
                        <strong className="text-slate-200 font-mono">
                          {item.leadTimeDays}d
                        </strong>
                      </span>
                    )}
                    {item.moq !== null && (
                      <span>
                        MOQ:{" "}
                        <strong className="text-slate-200 font-mono">
                          {item.moq} {item.baseUnit}
                        </strong>
                      </span>
                    )}
                  </div>

                  {(item.specs.length > 0 ||
                    item.certifications.length > 0) && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {item.specs.map((spec) => (
                        <span
                          key={`spec-${spec}`}
                          className="text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300"
                        >
                          {spec}
                        </span>
                      ))}
                      {item.certifications.map((cert) => (
                        <span
                          key={`cert-${cert}`}
                          className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
                        >
                          {cert}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="shrink-0">
                  <button
                    type="button"
                    disabled={deletingItemId === item.itemId}
                    aria-label={`Delete ${item.productTitle}`}
                    onClick={() => void handleDeleteItem(item)}
                    className="inline-flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40 px-2.5 py-1 text-[11px] text-red-300 cursor-pointer"
                  >
                    {deletingItemId === item.itemId ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                    <span>Delete</span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
