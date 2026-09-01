import { geoNaturalEarth1, geoPath } from "d3-geo";
import { useEffect, useState } from "react";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { RankedBars } from "./RankedBars";

export interface CountrySlice {
  value: string;
  clicks: number;
  uniques: number;
}

interface CountryPath {
  /** ISO 3166-1 numeric code, zero-padded to three digits (the atlas's own id format). */
  id: string;
  name: string;
  d: string;
}

const RAMP = [
  "var(--color-ramp-1)",
  "var(--color-ramp-2)",
  "var(--color-ramp-3)",
  "var(--color-ramp-4)",
  "var(--color-ramp-5)",
];

// The API returns ISO 3166-1 alpha-2 codes ("IT", "FR"); world-atlas keys its
// topology by ISO 3166-1 numeric codes, zero-padded to three digits as
// strings (e.g. Argentina is "032", not "32" or 32). Confirmed by inspecting
// the installed world-atlas@2.0.2 package directly rather than assuming a
// property name — `node -e "require('world-atlas/countries-110m.json')"`
// shows each entry as `{ id: "032", properties: { name: "Argentina" } }`,
// with no other identifier field on the geometry at all.
//
// This table is deliberately scoped to the ~174 countries the 110m atlas
// actually carries geometry for (it drops a handful of contested territories
// with no numeric id at all, e.g. Kosovo, and the smallest microstates, e.g.
// Andorra, don't survive 110m simplification). A code that isn't a key here
// either isn't a real alpha-2 or names something the atlas can't draw either
// way, so falling through to "no data" is correct, not a guess.
const alpha2ToNumeric: Record<string, string> = {
  AF: "004",
  AL: "008",
  DZ: "012",
  AO: "024",
  AQ: "010",
  AR: "032",
  AM: "051",
  AU: "036",
  AT: "040",
  AZ: "031",
  BS: "044",
  BD: "050",
  BY: "112",
  BE: "056",
  BZ: "084",
  BJ: "204",
  BT: "064",
  BO: "068",
  BA: "070",
  BW: "072",
  BR: "076",
  BN: "096",
  BG: "100",
  BF: "854",
  BI: "108",
  KH: "116",
  CM: "120",
  CA: "124",
  CF: "140",
  TD: "148",
  CL: "152",
  CN: "156",
  CO: "170",
  CG: "178",
  CR: "188",
  CI: "384",
  HR: "191",
  CU: "192",
  CY: "196",
  CZ: "203",
  CD: "180",
  DK: "208",
  DJ: "262",
  DO: "214",
  EC: "218",
  EG: "818",
  SV: "222",
  GQ: "226",
  ER: "232",
  EE: "233",
  SZ: "748",
  ET: "231",
  FK: "238",
  FJ: "242",
  FI: "246",
  TF: "260",
  FR: "250",
  GA: "266",
  GM: "270",
  GE: "268",
  DE: "276",
  GH: "288",
  GR: "300",
  GL: "304",
  GT: "320",
  GN: "324",
  GW: "624",
  GY: "328",
  HT: "332",
  HN: "340",
  HU: "348",
  IS: "352",
  IN: "356",
  ID: "360",
  IR: "364",
  IQ: "368",
  IE: "372",
  IL: "376",
  IT: "380",
  JM: "388",
  JP: "392",
  JO: "400",
  KZ: "398",
  KE: "404",
  KW: "414",
  KG: "417",
  LA: "418",
  LV: "428",
  LB: "422",
  LS: "426",
  LR: "430",
  LY: "434",
  LT: "440",
  LU: "442",
  MK: "807",
  MG: "450",
  MW: "454",
  MY: "458",
  ML: "466",
  MR: "478",
  MX: "484",
  MD: "498",
  MN: "496",
  ME: "499",
  MA: "504",
  MZ: "508",
  MM: "104",
  NA: "516",
  NP: "524",
  NL: "528",
  NC: "540",
  NZ: "554",
  NI: "558",
  NE: "562",
  NG: "566",
  KP: "408",
  NO: "578",
  OM: "512",
  PK: "586",
  PS: "275",
  PA: "591",
  PG: "598",
  PY: "600",
  PE: "604",
  PH: "608",
  PL: "616",
  PT: "620",
  PR: "630",
  QA: "634",
  RO: "642",
  RU: "643",
  RW: "646",
  SS: "728",
  SA: "682",
  SN: "686",
  RS: "688",
  SL: "694",
  SK: "703",
  SI: "705",
  SB: "090",
  SO: "706",
  ZA: "710",
  KR: "410",
  ES: "724",
  LK: "144",
  SD: "729",
  SR: "740",
  SE: "752",
  CH: "756",
  SY: "760",
  TW: "158",
  TJ: "762",
  TZ: "834",
  TH: "764",
  TL: "626",
  TG: "768",
  TT: "780",
  TN: "788",
  TR: "792",
  TM: "795",
  UG: "800",
  UA: "804",
  AE: "784",
  GB: "826",
  US: "840",
  UY: "858",
  UZ: "860",
  VU: "548",
  VE: "862",
  VN: "704",
  EH: "732",
  YE: "887",
  ZM: "894",
  ZW: "716",
};

const numericToAlpha2 = new Map(
  Object.entries(alpha2ToNumeric).map(([alpha2, id]) => [id, alpha2]),
);

const PROJECTION = geoNaturalEarth1();
const PATH = geoPath(PROJECTION);
const VIEW_BOX = "0 0 960 500";

type CountryTopology = Topology<{ countries: GeometryCollection<{ name: string }> }>;

/** Turns the dynamically-imported atlas module into flat, render-ready
 *  country paths, isolated from the component so the effect body stays a
 *  thin "load, then set state" shell. */
function toCountryPaths(topologyModule: unknown): CountryPath[] {
  const topology = (topologyModule as { default: CountryTopology }).default;
  const collection = feature(topology, topology.objects.countries);
  const paths: CountryPath[] = [];
  for (const geoFeature of collection.features) {
    const d = PATH(geoFeature);
    if (!d) continue; // Antarctica-at-this-projection and other degenerate geometries.
    paths.push({
      id: String(geoFeature.id ?? ""),
      name: geoFeature.properties.name,
      d,
    });
  }
  return paths;
}

/** A sequential choropleth over `{ value: <ISO 3166-1 alpha-2>, clicks }`.
 *
 * The ranked list is the data and renders unconditionally and synchronously;
 * the map is the illustration on top of it and only appears once the atlas
 * chunk — loaded lazily, so pages that never show this component never pay
 * for it — has resolved. A reader on a slow connection or with the chunk
 * blocked still gets every number the map would have shown. */
export function WorldMap({ slices }: { slices: CountrySlice[] }) {
  const [countries, setCountries] = useState<CountryPath[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("world-atlas/countries-110m.json").then((topologyModule) => {
      if (cancelled) return;
      setCountries(toCountryPaths(topologyModule));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const byCountry = new Map(slices.map((s) => [s.value, s.clicks]));
  const max = Math.max(...slices.map((s) => s.clicks), 1);

  function clicksFor(countryId: string): number {
    const alpha2 = numericToAlpha2.get(countryId);
    // An id the topology carries but our table doesn't recognise (or that
    // recognises no clicks in this period) is absence, not a zero-th step.
    return alpha2 ? (byCountry.get(alpha2) ?? 0) : 0;
  }

  function colorFor(clicks: number): string {
    if (clicks === 0) return "var(--color-surface-sunken)";
    const step = Math.min(4, Math.floor((clicks / max) * 5));
    return RAMP[step] as string;
  }

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <div className="md:w-2/5 md:shrink-0">
        <RankedBars slices={slices} label="Clicks by country" />
      </div>

      {/* Purely decorative on top of already-accessible data: the list above
          is this chart's one accessible entry point, same reasoning as the
          time series' hidden-from-AT <svg> plot. */}
      {countries && slices.length > 0 ? (
        <svg aria-hidden="true" viewBox={VIEW_BOX} className="w-full md:w-3/5">
          {countries.map((country) => {
            const clicks = clicksFor(country.id);
            return (
              // A handful of contested territories (e.g. Kosovo) carry no
              // numeric id at all, so `country.id` alone is not always a
              // unique key across ~177 features — falling back to `name`
              // (unique in this atlas) keeps React's reconciliation honest;
              // `data-country` stays the raw (possibly empty) id, since an
              // empty id correctly never matches any alpha-2 code.
              <path
                key={country.id || country.name}
                data-country={country.id}
                d={country.d}
                style={{ fill: colorFor(clicks) }}
                stroke="var(--color-surface)"
                strokeWidth={0.5}
              >
                <title>{`${country.name}: ${clicks} clicks`}</title>
              </path>
            );
          })}
        </svg>
      ) : null}
    </div>
  );
}
