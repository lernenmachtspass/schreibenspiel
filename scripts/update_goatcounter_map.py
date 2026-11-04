#!/usr/bin/env python3
"""Fetch all-time GoatCounter pageview and location statistics for a static map.""" 

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

import pycountry
import requests

SITE = os.environ.get("GOATCOUNTER_SITE", "schreibenspiel")
TOKEN = os.environ.get("GOATCOUNTER_API_TOKEN")
API = f"https://{SITE}.goatcounter.com/api/v0"
# GoatCounter started long after 2000; this safely covers the site's full history.
START = "2000-01-01T00:00:00Z"
TIMEOUT = 30


def api_get(path: str, params: dict | None = None) -> dict:
    if not TOKEN:
        raise RuntimeError("Missing GOATCOUNTER_API_TOKEN environment variable.")
    response = requests.get(
        f"{API}/{path.lstrip('/')}",
        params=params,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json",
        },
        timeout=TIMEOUT,
    )
    if not response.ok:
        raise RuntimeError(
            f"GoatCounter API request failed ({response.status_code}) "
            f"for {response.url}: {response.text[:500]}"
        )
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError(f"Unexpected API response for {path}: expected JSON object.")
    return payload


def country_alpha2(item: dict) -> str | None:
    # Some GoatCounter versions/data sets may provide an ISO-like ID.
    raw_id = str(item.get("id", "")).strip().upper()
    if re.fullmatch(r"[A-Z]{2}", raw_id):
        country = pycountry.countries.get(alpha_2=raw_id)
        if country:
            return country.alpha_2

    name = str(item.get("name", "")).strip()
    if not name:
        return None

    aliases = {
        "USA": "US",
        "U.S.A.": "US",
        "United States of America": "US",
        "UK": "GB",
        "South Korea": "KR",
        "North Korea": "KP",
        "Russia": "RU",
        "Vietnam": "VN",
        "Iran": "IR",
        "Syria": "SY",
        "Bolivia": "BO",
        "Tanzania": "TZ",
        "Moldova": "MD",
        "Venezuela": "VE",
        "Taiwan": "TW",
        "Czech Republic": "CZ",
        "Kosovo": None,  # Not an ISO 3166-1 assigned country code.
    }
    if name in aliases:
        return aliases[name]

    try:
        return pycountry.countries.lookup(name).alpha_2
    except LookupError:
        return None


def get_all_locations() -> tuple[list[dict], list[str]]:
    collected: dict[str, dict] = {}
    unmapped: list[str] = []
    offset = 0
    page_size = 100

    while True:
        payload = api_get(
            "stats/locations",
            {
                "start": START,
                "end": datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0).isoformat(),
                "limit": page_size,
                "offset": offset,
            },
        )
        rows = payload.get("stats", [])
        if not isinstance(rows, list):
            raise RuntimeError("Unexpected GoatCounter locations response: 'stats' is not a list.")

        for row in rows:
            if not isinstance(row, dict):
                continue
            code = country_alpha2(row)
            count = int(row.get("count", 0) or 0)
            name = str(row.get("name", "")).strip()
            if not code:
                if name and name not in unmapped:
                    unmapped.append(name)
                continue
            if code not in collected:
                country = pycountry.countries.get(alpha_2=code)
                collected[code] = {
                    "code": code,
                    "name": country.name if country else name,
                    "count": 0,
                }
            collected[code]["count"] += count

        more = bool(payload.get("more"))
        if not more:
            break
        if not rows:
            raise RuntimeError("GoatCounter reported more location rows but returned an empty page.")
        offset += len(rows)

    locations = sorted(collected.values(), key=lambda x: (-x["count"], x["name"]))
    return locations, unmapped


def main() -> None:
    # The API's total endpoint is date-range based; explicitly request the full history.
    end = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0).isoformat()
    total_payload = api_get("stats/total", {"start": START, "end": end})
    if "total" not in total_payload:
        raise RuntimeError("GoatCounter total response did not contain 'total'.")

    locations, unmapped = get_all_locations()

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "site": SITE,
        "metric": "pageviews",
        "total_pageviews": int(total_payload["total"]),
        "locations": locations,
        "unmapped_location_names": unmapped,
        "period_start": START,
        "period_end": end,
    }

    destination = Path("public/data/goatcounter-map.json")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Updated {destination}: {output['total_pageviews']:,} pageviews, "
        f"{len(locations)} mapped countries, {len(unmapped)} unmapped location labels."
    )
    if unmapped:
        print("Unmapped location labels (not shown on country map): " + ", ".join(unmapped))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
