#!/usr/bin/env python3
"""
Offline build-time ETL pipeline for Kulgo ESG Factor Matrix (FACTOR_MATRIX_VERSION = "2026.1").

This script runs strictly offline (never imported by @kulgo/engine at runtime) to:
1. Verify SHA-256 checksums of pinned open-source dataset archives.
2. Parse EXIOBASE v3.8.2 `pxp` (Zenodo Record 5589597 — CC-BY-SA 4.0 ONLY; v3.9+ rejected)
   using `pymrio` + `scipy.linalg.solve` with IPCC AR6 GWP100 characterization weights.
3. Flag zero-output domestic sectors (`NULL_DOMESTIC_PRODUCTION`) so `@kulgo/engine`
   never emits a false 0 kgCO2e/EUR factor.
4. Apply pinned Eurostat PPI/HICP deflators to convert base-year EUR factors to 2026 EUR.
5. Emit a standalone, license-isolated TypeScript/JSON data artifact for `@kulgo/engine`.

License Separation Notice:
- This ETL script is part of Kulgo's build tooling.
- Any generated EXIOBASE v3.8.2 factor table (`exiobase382-factors.json` / `.ts`) is
  distributed strictly as an isolated data file under CC-BY-SA 4.0 with full attribution
  to Stadler et al. (2021), Zenodo Record 5589597.
- Physical factor tables (ADEME Etalab 2.0, UK DESNZ OGL v3.0, EU JRC CBAM CC-BY 4.0)
  and US EPA USEEIO v1.3 (CC0 1.0) are emitted in separate attribution-only modules.

Usage:
  python3 scripts/etl/compile-esg-factors.py \\
    --exiobase-zip /path/to/IOT_2022_pxp.zip \\
    --base-year 2022 \\
    --out-json packages/engine/src/data/exiobase382-compiled.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

FACTOR_MATRIX_VERSION = "2026.1"

# Pinned Zenodo Record 5589597 (EXIOBASE v3.8.2 — CC-BY-SA 4.0 ONLY).
ALLOWED_EXIOBASE_RELEASES = {
    "IOT_2019_pxp.zip": {
        "zenodo_record": "5589597",
        "license": "CC-BY-SA-4.0",
        "base_year": 2019,
        "vintage_type": "PRE_PANDEMIC_BENCHMARK",
    },
    "IOT_2022_pxp.zip": {
        "zenodo_record": "5589597",
        "license": "CC-BY-SA-4.0",
        "base_year": 2022,
        "vintage_type": "NOWCAST",
    },
}

# IPCC AR6 GWP100 characterization weights (biogenic CO2 excluded from fossil total).
AR6_GWP100: dict[str, float] = {
    "CO2 - combustion - air": 1.0,
    "CO2 - non combustion - Cement production - air": 1.0,
    "CO2 - non combustion - Lime production - air": 1.0,
    "CH4 - combustion - air": 29.8,
    "CH4 - non combustion - Extraction/production of (natural) gas - air": 29.8,
    "CH4 - non combustion - Extraction/production of crude oil - air": 29.8,
    "CH4 - non combustion - Mining of antracite - air": 29.8,
    "CH4 - non combustion - Mining of bituminous coal - air": 29.8,
    "CH4 - non combustion - Mining of coking coal - air": 29.8,
    "CH4 - non combustion - Mining of lignite (brown coal) - air": 29.8,
    "CH4 - non combustion - Mining of sub-bituminous coal - air": 29.8,
    "CH4 - agriculture - air": 27.0,
    "CH4 - waste - air": 27.0,
    "N2O - combustion - air": 273.0,
    "N2O - agriculture - air": 273.0,
    "SF6 - air": 25200.0,
    "HFC - air": 1430.0,
    "PFC - air": 7380.0,
}

# Pinned Eurostat PPI/HICP deflators converting 2022 base-year EUR -> 2026 EUR.
EUROSTAT_2022_TO_2026_DEFLATOR: dict[str, float] = {
    "Metals": 0.9225,
    "Chemicals": 0.8993,
    "Electronics": 0.9107,
    "Packaging": 0.9050,
    "Logistics": 0.8651,
    "Manufacturing": 0.8945,
}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def compile_exiobase_pxp(zip_path: Path, base_year: int) -> dict[str, Any]:
    filename = zip_path.name
    if filename not in ALLOWED_EXIOBASE_RELEASES:
        raise ValueError(
            f"Refusing non-allowlisted archive '{filename}'. "
            "Only EXIOBASE v3.8.2 pxp archives from Zenodo 5589597 (CC-BY-SA 4.0) "
            "are permitted for commercial SaaS builds; EXIOBASE v3.9+ is non-commercial."
        )

    try:
        import numpy as np  # type: ignore[import-not-found]
        import pymrio  # type: ignore[import-not-found]
        from scipy.linalg import solve  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError(
            "Offline ETL requires `pymrio`, `numpy`, and `scipy` "
            "(install via `pip install pymrio numpy scipy`)."
        ) from exc

    archive_sha256 = sha256_file(zip_path)
    io = pymrio.parse_exiobase3(path=str(zip_path))

    # Align indices and compute direct stressor vector d = w^T S (kg CO2e / MEUR).
    A = io.A.to_numpy(dtype=np.float64)
    x = io.x.iloc[:, 0].to_numpy(dtype=np.float64)
    S_df = io.satellite.S

    d = np.zeros(A.shape[0], dtype=np.float64)
    matched_rows: list[str] = []
    for stressor_name, gwp in AR6_GWP100.items():
        if stressor_name in S_df.index:
            d += gwp * S_df.loc[stressor_name].to_numpy(dtype=np.float64)
            matched_rows.append(stressor_name)

    if not matched_rows:
        raise RuntimeError("No IPCC AR6 GHG rows matched in EXIOBASE satellite.S")

    # Solve (I - A)^T m = d without explicitly inverting (I - A).
    eye = np.eye(A.shape[0], dtype=np.float64)
    m_kg_per_meur = solve((eye - A).T, d)
    m_kg_per_eur = m_kg_per_meur / 1_000_000.0

    factors: dict[str, dict[str, float | None]] = {}
    null_domestic_count = 0

    for idx, (region, product) in enumerate(io.A.columns):
        region_bucket = factors.setdefault(str(region), {})
        if not np.isfinite(x[idx]) or x[idx] <= 0.0 or not np.isfinite(m_kg_per_eur[idx]) or m_kg_per_eur[idx] <= 0.0:
            # Critical zero-output guard: never emit 0 kgCO2e/EUR for absent domestic production.
            region_bucket[str(product)] = None
            null_domestic_count += 1
        else:
            region_bucket[str(product)] = round(float(m_kg_per_eur[idx]), 6)

    meta = ALLOWED_EXIOBASE_RELEASES[filename]
    return {
        "factorMatrixVersion": FACTOR_MATRIX_VERSION,
        "provenanceStatus": "ETL_COMPILED",
        "source": "EXIOBASE v3.8.2 pxp (Stadler et al. 2021, Zenodo Record 5589597)",
        "license": meta["license"],
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/legalcode.en",
        "archiveFile": filename,
        "archiveSha256": archive_sha256,
        "baseYear": base_year,
        "vintageType": meta["vintage_type"],
        "gwpBasis": "IPCC_AR6_GWP100",
        "unit": "kgCO2e / EUR_base_basic",
        "matchedStressorRows": matched_rows,
        "nullDomesticProductionCells": null_domestic_count,
        "eurostat2022To2026Deflators": EUROSTAT_2022_TO_2026_DEFLATOR,
        "compiledAt": datetime.now(timezone.utc).isoformat(),
        "factorsByRegionAndProduct": factors,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Compile Kulgo offline EXIOBASE v3.8.2 pxp ESG factor matrix."
    )
    parser.add_argument(
        "--exiobase-zip",
        type=Path,
        required=True,
        help="Path to pinned Zenodo 5589597 IOT_2019_pxp.zip or IOT_2022_pxp.zip",
    )
    parser.add_argument(
        "--base-year",
        type=int,
        default=2022,
        help="Model base year of the EXIOBASE archive (2019 or 2022)",
    )
    parser.add_argument(
        "--out-json",
        type=Path,
        required=True,
        help="Output JSON path for compiled CC-BY-SA 4.0 factor pack",
    )
    args = parser.parse_args(argv)

    payload = compile_exiobase_pxp(args.exiobase_zip, args.base_year)
    args.out_json.parent.mkdir(parents=True, exist_ok=True)
    args.out_json.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(
        f"Wrote {args.out_json} (sha256={payload['archiveSha256'][:12]}..., "
        f"null_cells={payload['nullDomesticProductionCells']})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
